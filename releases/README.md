# FitLog 最新交付：V1.3

- [Android APK](FitLog-V1.3-debug.apk)
- [完整源码包](FitLog-V1.3-source.zip)
- [测试报告](../docs/TEST_RESULTS.md)

先从旧版导出完整JSON到Documents，再直接覆盖安装新版，不要卸载。新增单侧动作左右分组、动作感受、下次提醒和可选目标次数；已有计划及历史保留。32项单元/SQLite与5项界面测试通过，真机升级与系统文件导出尚未验证。

APK沿用原生包更新前端资源并使用同一开发签名。内部Android版本仍为1.0，完整Gradle重建受缺失插件缓存影响未成功。签名与包完整性检查通过，详见测试报告。
