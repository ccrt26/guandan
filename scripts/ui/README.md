# UI 开发工具

compare_gameplay.py、compare_tribute.py、compare_stats.py：以新截图对批准参考做图像比较，输出使用 GD_TASK_ID/GD_TASK_OUTPUT_ROOT，默认新 lab/out 任务目录。需要 NumPy/Pillow 的既有环境，本轮不安装也不运行。

generate-tribute-fixtures.ts：从真实引擎生成贡还 fixture 到新任务目录；本轮只迁移及语法检查，不执行牌局。正式被程序引用的 fixture/provenance 在 packages/web/src/dev/fixtures/tribute/，不会自动覆盖。

hub-seed/{seed.html,seed.ts}：仅隔离空测试浏览器的开发验收源代码，默认不接入产品，也不自动操作浏览器。

旧截图/热图/临时日志按用户最新清理要求移Trash；批准设计参考仍保留，恢复位置见治理记录。
