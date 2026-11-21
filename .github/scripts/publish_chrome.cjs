const { sign } = require('node:crypto');
const { readFile } = require('node:fs/promises');
const { resolve } = require('node:path');
const { setTimeout: delay } = require('node:timers/promises');

const extensionId = 'pmbggejjcjmeolnopeaoaimphaamhkbi';
const tokenUrl = 'https://oauth2.googleapis.com/token';
const api = 'https://chromewebstore.googleapis.com';
const root = resolve(__dirname, '../..');

async function request(label, url, options) {
    let response;
    try {
        response = await fetch(url, { ...options, redirect: 'error', signal: AbortSignal.timeout(25000) });
    } catch {
        throw new Error(`${label} did not return a response. Check store status before retrying.`);
    }
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
        const code = result.error?.status || (typeof result.error === 'string' ? result.error : '');
        const reason = /^[A-Z_]+$/i.test(code) ? ` ${code}.` : '';
        // Never log OAuth responses or content from the credentials JSON.
        const detail = url === tokenUrl ? '' : result.error?.message;
        throw new Error(`${label} returned HTTP ${response.status}.${reason}${detail ? ` ${detail}` : ''}`);
    }
    return result;
}

async function accessToken(scope) {
    let account;
    try {
        account = JSON.parse(process.env.CHROME_SERVICE_ACCOUNT_JSON?.trim());
    } catch {
        throw new Error('CHROME_SERVICE_ACCOUNT_JSON must contain the full service account JSON key.');
    }
    if (account?.type !== 'service_account' || !account.client_email || !account.private_key) {
        throw new Error('The service account JSON is missing its email or private key.');
    }

    const encode = object => Buffer.from(JSON.stringify(object)).toString('base64url');
    const now = Math.floor(Date.now() / 1000);
    const header = encode({ alg: 'RS256', typ: 'JWT', kid: account.private_key_id });
    const claims = encode({ iss: account.client_email, scope, aud: tokenUrl, iat: now, exp: now + 600 });
    const assertion = `${header}.${claims}`;
    const signature = sign('RSA-SHA256', Buffer.from(assertion), account.private_key).toString('base64url');
    const result = await request('Google authentication', tokenUrl, {
        method: 'POST',
        body: new URLSearchParams({
            grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
            assertion: `${assertion}.${signature}`,
        }),
    });
    if (!result.access_token) throw new Error('Google did not return an access token.');
    return result.access_token;
}

function versions(revision) {
    return (revision?.distributionChannels ?? []).map(channel => channel.crxVersion).filter(Boolean);
}

async function main() {
    const manifest = JSON.parse((await readFile(resolve(root, 'manifest.json'), 'utf8')).replace(/^\uFEFF/, ''));
    const version = manifest.version;
    if (!/^\d+(?:\.\d+){0,3}$/.test(version) || version !== process.env.CHROME_VERSION?.trim()) {
        throw new Error(`Requested version must match manifest version ${version}.`);
    }
    const publisher = process.env.CHROME_PUBLISHER_ID?.trim();
    if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(publisher ?? '')) {
        throw new Error('CHROME_PUBLISHER_ID must be the Publisher ID from Chrome Web Store Settings.');
    }
    const shouldSubmit = process.env.CHROME_SUBMIT === 'true';
    const scope = 'https://www.googleapis.com/auth/chromewebstore';
    const token = await accessToken(shouldSubmit ? scope : `${scope}.readonly`);
    if (process.env.GITHUB_ACTIONS === 'true') console.log(`::add-mask::${token}`);
    const item = `publishers/${publisher}/items/${extensionId}`;
    const headers = { Authorization: `Bearer ${token}` };
    const fetchStatus = async () => {
        const status = await request('Chrome item status', `${api}/v2/${item}:fetchStatus`, { headers });
        if (status.itemId !== extensionId) throw new Error('Chrome returned an unexpected item ID.');
        return status;
    };

    const status = await fetchStatus();
    const published = status.publishedItemRevisionStatus;
    const submitted = status.submittedItemRevisionStatus;
    console.log(`Chrome store access verified. Published version: ${versions(published).join(', ') || 'none'}.`);
    if (submitted) {
        console.log(`Existing submission: ${submitted.state}, version ${versions(submitted).join(', ') || 'unknown'}.`);
    }
    if (!shouldSubmit || versions(published).includes(version)) return;
    if (status.takenDown || status.warned || published?.state !== 'PUBLISHED') {
        throw new Error('Review the current item status in the Chrome developer dashboard before submitting.');
    }
    if (['PENDING_REVIEW', 'STAGED'].includes(submitted?.state)) {
        if (versions(submitted).includes(version)) return;
        throw new Error('The store already has an active submission. Check the dashboard before uploading.');
    }

    const zip = await readFile(resolve(root, `Video-skipping-and-anime-TV-series-tracking-assistant-v${version}.zip`));
    const upload = await request('Chrome package upload', `${api}/upload/v2/${item}:upload`, {
        method: 'POST', headers: { ...headers, 'Content-Type': 'application/zip' }, body: zip,
    });
    if (upload.itemId !== extensionId || (upload.crxVersion && upload.crxVersion !== version)) {
        throw new Error('The upload response did not match the requested item and package.');
    }
    let uploadState = upload.uploadState;
    for (let attempt = 0; uploadState === 'IN_PROGRESS' && attempt < 36; attempt++) {
        await delay(5000);
        uploadState = (await fetchStatus()).lastAsyncUploadState;
    }
    if (uploadState !== 'SUCCEEDED') {
        throw new Error(`Chrome package upload status: ${uploadState || 'unknown'}. Check the dashboard before retrying.`);
    }
    console.log(`Chrome accepted the v${version} package.`);

    const review = await request('Chrome review submission', `${api}/v2/${item}:publish`, {
        method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: '{}',
    });
    if (review.itemId !== extensionId || !['PENDING_REVIEW', 'PUBLISHED', 'STAGED'].includes(review.state)) {
        throw new Error(`Unexpected review submission status: ${review.state || 'unknown'}. Check the dashboard before retrying.`);
    }
    console.log(`Chrome accepted v${version} review submission. State: ${review.state}.`);
    const confirmed = await fetchStatus();
    const revision = confirmed.submittedItemRevisionStatus ?? confirmed.publishedItemRevisionStatus;
    console.log(`Chrome status after submission: ${revision?.state || 'unknown'}, version ${versions(revision).join(', ') || 'unknown'}.`);
}

main().catch(error => {
    console.error(error.message);
    process.exitCode = 1;
});
