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

    # 2. 需要打包的文件列表 (支持文件和文件夹)
    items_to_zip = [
        "manifest.json",
        "background.js",
        "content.js",
        "popup.html",
        "popup.js",
        "options.html",
        "options.js",
        "icon.png",
        "README.md",
        "_locales"  # 新增：打包整个语言包目录
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
            for item in items_to_zip:
                if os.path.isfile(item):
                    # 如果是文件，直接添加
                    zf.write(item, arcname=item)
                    print(f"  + 添加文件: {item}")
                elif os.path.isdir(item):
                    # 如果是文件夹，递归添加
                    print(f"  + 添加目录: {item}/")
                    for root, dirs, files in os.walk(item):
                        for file in files:
                            file_path = os.path.join(root, file)
                            # 在压缩包中的路径（保持相对结构）
                            arcname = os.path.relpath(file_path, start='.')
                            zf.write(file_path, arcname=arcname)
                            print(f"    - {arcname}")
                else:
                    print(f"  ⚠️ 警告: 文件/目录缺失 - {item}")
    except Exception as e:
        print(f"打包失败: {e}")
        sys.exit(1)

    print("-" * 30)
    print(f"✅ 打包完成! 文件位于: {os.path.abspath(zip_filename)}")

if __name__ == "__main__":
    pack_extension()
