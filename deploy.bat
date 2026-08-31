@echo off
REM Sinoky v0.1.1 部署脚本 (Windows)
REM 使用方法: 双击运行或在命令行执行 deploy.bat

echo 🚀 Sinoky v0.1.1 部署脚本
echo ========================

REM 1. 检查文件
echo 1^) 检查文件完整性...
if not exist "index.html" (
    echo ❌ 缺少文件: index.html
    exit /b 1
)
if not exist "manifest.webmanifest" (
    echo ❌ 缺少文件: manifest.webmanifest
    exit /b 1
)
if not exist "sw.js" (
    echo ❌ 缺少文件: sw.js
    exit /b 1
)
if not exist "version.json" (
    echo ❌ 缺少文件: version.json
    exit /b 1
)
if not exist "icons\" (
    echo ❌ 缺少文件: icons\
    exit /b 1
)
echo ✅ 文件完整性检查通过

REM 2. 检查版本号
echo.
echo 2^) 检查版本号...
for /f "tokens=2 delims=:," %%a in ('type version.json ^| findstr /C:"version"') do (
    set CURRENT_VERSION=%%a
)
set CURRENT_VERSION=!CURRENT_VERSION:"=!
echo 当前版本: !CURRENT_VERSION!

REM 3. Git 提交
echo.
echo 3^) Git 提交...
git add .
git commit -m "feat: Sinoky v0.1.1 部署准备"
echo ✅ Git 提交完成

REM 4. 推送到 GitHub
echo.
echo 4^) 推送到 GitHub...
git push origin main
echo ✅ GitHub 推送完成

echo.
echo ========================
echo 🎉 部署脚本执行完成！
echo.
echo 📝 下一步操作：
echo 1. 访问 Cloudflare Dashboard: https://dash.cloudflare.com/
echo 2. 进入 Workers ^& Pages → Create application → Pages → Connect to Git
echo 3. 选择仓库: Dukekang0124/sinoky
echo 4. 配置构建: Build command = ^(留空^), Build output directory = .
echo 5. 点击 Save and Deploy
echo.
echo ⏱️  部署完成后^(1-2分钟^)，访问 https://sinoky.pages.dev 验证
pause
