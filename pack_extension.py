import zipfile
import json
import os
import sys

def pack_extension():
    # 1. 自动从 manifest.json 读取版本号
    manifest_path = 'manifest.json'
    if not os.path.exists(manifest_path):
        print(f"错误: 找不到 {manifest_path}")
        sys.exit(1)

    try:
        with open(manifest_path, 'r', encoding='utf-8') as f:
            manifest = json.load(f)
            version = manifest.get('version', 'unknown')
    except Exception as e:
        print(f"读取 manifest.json 失败: {e}")
        sys.exit(1)

    # 动态生成文件名
    zip_filename = f"Video-skipping-and-anime-TV-series-tracking-assistant-v{version}.zip"

    # 2. 需要打包的文件列表
    files_to_zip = [
        "manifest.json",
        "background.js",
        "content.js",
        "popup.html",
        "popup.js",
        "options.html",
        "options.js",
        "icon.png",
        "README.md"
    ]

    # 3. 移除旧文件 (如果存在)
    if os.path.exists(zip_filename):
        try:
            os.remove(zip_filename)
            print(f"已移除旧文件: {zip_filename}")
        except OSError as e:
            print(f"无法移除旧文件: {e}")

    # 4. 创建压缩包
    print(f"正在创建: {zip_filename} ...")
    try:
        with zipfile.ZipFile(zip_filename, 'w', zipfile.ZIP_DEFLATED) as zf:
            for file_path in files_to_zip:
                if os.path.exists(file_path):
                    # write(本地路径, 压缩包内的名称)
                    zf.write(file_path, arcname=file_path)
                    print(f"  + 添加: {file_path}")
                else:
                    print(f"  ⚠️ 警告: 文件缺失 - {file_path}")
    except Exception as e:
        print(f"打包失败: {e}")
        sys.exit(1)

    print("-" * 30)
    print(f"✅ 打包完成! 文件位于: {os.path.abspath(zip_filename)}")

if __name__ == "__main__":
    pack_extension()
