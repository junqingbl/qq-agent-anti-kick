@echo off
chcp 936 >nul
title 防踢优化包
cd /d "%~dp0"
echo.
echo  防踢优化包 - 正在检查...
echo.
node "%~dp0run.mjs" %*
echo.
echo  按任意键关闭...
pause >nul
