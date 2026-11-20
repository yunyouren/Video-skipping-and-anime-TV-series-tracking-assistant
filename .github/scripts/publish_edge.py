"""Upload an existing extension's ZIP, then submit its draft for certification."""

import json
import os
from pathlib import Path
import re
import sys
import time
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener
from uuid import UUID
from zipfile import ZipFile


API_ROOT = 'https://api.addons.microsoftedge.microsoft.com/v1/products'
ROOT = Path(__file__).resolve().parents[2]


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def main():
    expected = os.environ.get('EDGE_VERSION', '').strip()
    version = json.loads((ROOT / 'manifest.json').read_text(encoding='utf-8-sig'))['version']
    if not re.fullmatch(r'\d+(?:\.\d+){0,3}', version) or version != expected:
        raise ValueError(f'Requested version must match manifest version {version}.')

    package = ROOT / f'Video-skipping-and-anime-TV-series-tracking-assistant-v{version}.zip'
    with ZipFile(package) as archive:
        if archive.testzip() or json.loads(archive.read('manifest.json'))['version'] != version:
            raise ValueError('Package integrity or manifest version check failed.')

    env_names = ('EDGE_PRODUCT_ID', 'EDGE_CLIENT_ID', 'EDGE_API_KEY')
    credentials = {name: os.environ.get(name, '').strip() for name in env_names}
    missing = [name for name, value in credentials.items() if not value]
    if missing:
        raise ValueError(f'Missing GitHub Actions Secrets: {", ".join(missing)}')
    try:
        product_id = str(UUID(credentials['EDGE_PRODUCT_ID']))
    except ValueError:
        raise ValueError('EDGE_PRODUCT_ID must be the Partner Center Product ID (UUID).') from None

    def redact(message):
        for value in credentials.values():
            message = message.replace(value, '[redacted]')
        return message

    opener = build_opener(NoRedirect())
    product_url = f'{API_ROOT}/{product_id}/submissions'

    def request(url, body=None, content_type=None):
        headers = {'Authorization': f'ApiKey {credentials["EDGE_API_KEY"]}',
                   'X-ClientID': credentials['EDGE_CLIENT_ID'], 'Accept': 'application/json'}
        if content_type:
            headers['Content-Type'] = content_type
        try:
            with opener.open(Request(url, data=body, headers=headers), timeout=25) as response:
                return response.status, response.headers, response.read()
        except HTTPError as error:
            detail = redact(error.read(4096).decode('utf-8', errors='replace')).strip()
            raise RuntimeError(f'Edge Add-ons API returned HTTP {error.code}: {detail}') from None
        except URLError as error:
            raise RuntimeError(f'Edge Add-ons API connection error: {redact(str(error.reason))}') from None

    def start_operation(url, body, content_type, label):
        status, headers, _ = request(url, body, content_type)
        if status != 202:
            raise RuntimeError(f'{label} returned HTTP {status}; expected 202 Accepted.')
        location = headers.get('Location', '')
        try:
            operation_id = UUID(urlsplit(location).path.rstrip('/').rsplit('/', 1)[-1])
        except ValueError:
            raise RuntimeError(f'{label} was accepted but the response did not contain a valid operation ID.') from None
        print(f'{label} accepted. Operation {operation_id}.', flush=True)
        return str(operation_id)

    def wait_for_operation(url, label):
        deadline = time.monotonic() + 240
        while time.monotonic() < deadline:
            status, _, body = request(url)
            if status != 200:
                raise RuntimeError(f'{label} status check returned HTTP {status}.')
            result = json.loads(body)
            if result.get('status') == 'Succeeded':
                print(redact(f'{label} succeeded. {result.get("message") or ""}'), flush=True)
                return
            if result.get('status') not in {'InProgress', 'NotStarted'}:
                raise RuntimeError(redact(f'{label} did not succeed: {json.dumps(result, ensure_ascii=False)}'))
            time.sleep(5)
        raise RuntimeError(f'{label} is still pending. Check the operation in Partner Center before retrying.')

    notes = (
        f'Version {version}. Account sync is optional and disabled by default. '
        'Video skipping and local progress tracking can be tested without signing into an extension account. '
        'To test sync, install the same Edge add-on on two devices signed into the same Microsoft account. '
        'Enable extension sync in Edge and turn on the sync switch in Extension options > Advanced settings on both devices. '
        'Add a favorite and save playback progress on one device, then check the favorite and resume position on the other after Edge delivers the update.'
    )
    upload_url = f'{product_url}/draft/package'
    upload_id = start_operation(upload_url, package.read_bytes(), 'application/zip', 'Package upload')
    wait_for_operation(f'{upload_url}/operations/{upload_id}', 'Package validation')
    submit_id = start_operation(product_url, json.dumps({'notes': notes}).encode('utf-8'), 'application/json', 'Certification submission')
    wait_for_operation(f'{product_url}/operations/{submit_id}', 'Certification submission')
    print(f'v{version} submitted for certification. Check Partner Center for the review outcome.')


if __name__ == '__main__':
    try:
        main()
    except (OSError, RuntimeError, ValueError) as error:
        sys.exit(str(error))
