# FitLog V1

Android 离线力量训练记录器。UI → Service → Repository → 原生 SQLite。无账户、服务器、网络权限、广告或 AI。

## 交付与验证边界

请查看 `docs/TEST_RESULTS.md` 中的实际构建与测试状态。自动测试通过不等于已通过手机端验收；设备相关未验证项列在 `docs/DEVICE_CHECKLIST.md`。

## 目录

- `src/main.tsx`、`style.css`：今日、训练、周计划、历史、设置页面与输入交互。
- `src/domain.ts`：重量继承、级联更新、数值校验。
- `src/service.ts`：业务流程、写入队列、计划快照、导出和完整替换恢复。
- `src/repository.ts`：参数化 SQL 和历史来源查询。
- `src/db.ts`：Android SQLite 连接、事务、数据库迁移和完整性检查。
- `src/schema.ts`：七张表、外键、索引和约束。
- `src/preview.ts`：仅开发构建可用的内存 SQLite；不保存正式数据。
- `src/files.ts`：系统文件选择器接口。
- `android/`：完整 Capacitor Android / Gradle 工程。
- `android/app/src/main/java/com/jon/fitlog/FitLogFilesPlugin.java`：Storage Access Framework 保存、读取与内容复核。
- `tests/fitlog.test.ts`：算法和真实文件 SQLite 集成测试。
- `e2e/app.spec.ts`：移动尺寸界面测试。
- `docs/`：测试报告、安装和设备验收说明。

## 开发环境

Node.js 22+（本次使用 24）、JDK 21、Android SDK Platform 35、Build Tools 35.0.0、Android platform-tools。Android Studio 可负责安装 SDK；运行 Gradle 不强制打开 Android Studio。最低 Android 6 / API 23。建议使用更新的 Android System WebView。

```bash
npm ci
npm run dev
npm test
npx playwright install chromium
npm run test:ui
npm run build
```

浏览器开发预览只使用内存 SQLite，刷新重置；发布网页构建会拒绝充当正式数据库。Android 构建内不包含预览适配器或 SQLite WASM。

## 构建 Android APK

1. 配置 `JAVA_HOME` 指向 JDK 21。
2. 配置 Android SDK；Android Studio 可自动生成 `android/local.properties`，或写入 `sdk.dir=/你的/Android/sdk`。
3. 执行：

```bash
npm run sync
cd android
./gradlew assembleDebug
# Windows: gradlew.bat assembleDebug
```

或执行 `npm run apk`。APK 输出：`android/app/build/outputs/apk/debug/app-debug.apk`。

公开仓库不包含签名私钥。最初私下交付的源码包包含固定开发签名 `android/app/fitlog-debug.keystore`；如需生成能覆盖原APK的更新，请从原始交付包取出该文件放回本地同名路径，并保持私密。未提供该文件时，Gradle使用本机默认调试签名。不同签名不能直接覆盖安装；先独立备份，再处理安装。这不是商店发布签名。

## 安装

把 APK 下载到手机，点击安装。根据系统提示，允许你所用文件管理器/浏览器安装未知来源应用。首次启动选择“使用示例周计划”或“创建空白周计划”。不需要登录或联网。

ADB 安装：

```bash
adb install -r FitLog-V1-debug.apk
```

覆盖更新时保持相同应用 ID 和签名，不要使用卸载命令。应用 ID 为 `com.jon.fitlog`。

## SQLite 与数据安全

Android 正式版调用 `@capacitor-community/sqlite`，数据库为应用私有目录中的 `fitlogSQLite.db`，不是 localStorage / IndexedDB。UTC ISO 8601 时间存储，显示按设备本地时区转换。编辑写入串行执行；每个相关多表操作在事务中提交；每组完成后立即写入。保存失败显示错误，不显示成功。只有已经提交的数据能够保证在进程被终止后保留；“保存中”表示提交仍在进行。

Schema 当前为 v3。0→1 创建表结构，1→2 新增历史索引，2→3 新增左右侧、动作模式、目标次数快照、动作备注和下次提醒，并事务重建组表的侧别唯一约束。已有旧版数据库升级前先写入并同步私有 JSON 快照 `FitLog-pre-migration.json`；备份失败则停止迁移。迁移在事务中执行，不清表。启动执行 `PRAGMA integrity_check`，恢复执行外键与内容核对。更高版本数据库拒绝降级打开。

私有数据库与迁移快照在卸载/清除应用数据时都会丢失，不能替代下面的独立备份。

## 操作与重量规则

周计划可修改名称、休息状态、动作、顺序、目标次数、目标组数，以及每组默认重量，也可复制另一日。保存计划不会修改任何训练快照。

首次示例五个力量训练日均有动作、每个动作默认 3 组，重量和实际成绩为空；周三与周日休息，周六为胸 + 手臂。已有计划不会自动改写。需要第四组时可在计划中预设，或训练中点击增加一组；不做的组可删除。

重量优先级：手动输入 → 同动作 ID 最近有效已完成训练的对应组 → 当前动作上一组 → 本计划对应组默认值 → 空值。无历史时第一组读计划，后续组优先上一组。手动清空视为手动操作，不会被自动重新填入。未手动编辑、未完成的依赖组跟随上一组变化，历史来源与完成组保持锁定。历史训练修改仅影响未来创建的新训练。

次数和 RIR 默认空；上次次数只是输入框参考。0kg 表示无外加负重；空值表示未填写。完成组要求非空有效重量、实际次数为大于 0 的整数，RIR 可空或非负整数。

训练页输入自动保存，增加/删除组、临时添加/跳过动作即时保存。完成训练前需完成全部未跳过动作的组；未做组可删除。历史页编辑为临时草稿，必须点击“保存历史修改”；离开时询问是否放弃。删除训练有确认提示。

## 导出与恢复

设置 → 导出完整 JSON / CSV → Android 系统文件保存界面 → 选择手机 Documents 或其他可访问目录 → 保存。应用只有在写入结束并重新读取核对内容后报告成功；取消不算成功。未调用网络服务。

JSON 包含 `schema_version`、`exported_at` 和七张表，含计划、所有训练、草稿、每组重量、次数、RIR、完成状态和必要快照。CSV 为 UTF-8 BOM，每组一行，包含 UTC 时间、训练名、动作名、组序号、重量、次数、RIR、完成状态及动作跳过状态、侧别、动作备注和下次提醒；中文、逗号、引号和换行均转义。

恢复：先导出当前 JSON → 选择恢复文件 → 阅读完整替换提示 → 确认。V1只做完整替换，不合并。检查版本、字段、UUID、时间和数值；引用检查、插入及完整内容比对在同一事务中执行。异常回滚，原数据保留。恢复后显示计划、训练和组数，并重新加载页面数据。支持 v1/v2/v3 备份。旧备份补入新字段默认值，旧动作、ID、历史和草稿保持原样，不合并原先分开的左右动作。

系统文件插件读写文件限制为 25MiB。超限明确报错，不会报告备份成功。建议按月保存独立 JSON。

## 设备验收

按 `docs/DEVICE_CHECKLIST.md` 逐项检查：关闭重开、强制停止、重启、系统返回、软键盘、Documents 实际文件、卸载后从 JSON 恢复等。在设备验收完成前，建议同时保留现有训练记录。

## 计划专用导入
设置 → 导入训练计划 JSON。格式见 docs/plan-import-example.json，weekday为1至7，weights每个元素代表一组预设重量，null代表留空。仅替换文件包含的日期计划，保留训练历史和未完成训练。完整备份恢复仍是独立操作。示例周计划现在包含五个力量训练日，周三和周日休息。旧安装可在周计划点击“补全空白日期的示例动作”，不覆盖已有动作。

此前修正版文件FitLog-V1.1-debug.apk采用原APK替换发布前端资源后重新对齐、签名产生，详情见测试报告。APK内部版本保持1.0；原开发签名保持一致。

计划专用导入可写 `mode: "unilateral"`，并用 `weights_left` / `weights_right` 给每组独立预设；两数组需与 `weights` 等长。省略侧别数组时使用 `weights` 作为该侧预设，明确的 `null` 表示空值。

## V1.3 交互更新

- 周计划中选择“双手 / 双侧同时”或“单手 / 单侧分开”。单侧动作每个逻辑组显示左、右两行，分别填写重量、实际次数、RIR和完成状态；两侧完成才计为一组。增加与删除按整组操作。左右侧历史按稳定动作 ID、组序号和侧别匹配，互不继承，也不会把旧双手成绩当作单手成绩。历史中仅完成一侧的组不进入继承。
- 目标次数是可选的参考。点击“设置”展开，固定次数只填一个框；范围填最少、最多。可清除，不限制实际次数，不自动增加重量。训练页面展示创建训练时的目标快照。
- “本次感受”属于当前训练动作，活动训练自动保存，历史编辑需点保存。“下次提醒”按动作保留，新训练显示当时提醒快照，不自动覆盖重量。历史中显示原提醒，修改活动训练的提醒不会改写旧记录。
- “设为休息日”是有说明的开关。历史页保留月历、滑动切月、年份选择、单日筛选与全部记录。
- 完整 JSON 包括左右侧、动作模式、独立预设、备注和提醒；CSV 单侧动作每侧一行，以侧别区分。数据概览、训练进度与恢复结果按逻辑组计数。

本轮文件 `FitLog-V1.3-debug.apk` 延用原成功构建的原生包，更新发布前端资源后对齐、重新签名。完整 Gradle 重建因缺少插件缓存失败；内部 Android versionCode=1/versionName=1.0，界面和文件名标记 V1.3。详情、测试结果与未验证事项见 `docs/TEST_RESULTS.md`。覆盖安装前请先用旧版导出 JSON 到 Documents，保持原应用 ID 与签名，直接安装新版，不卸载旧版。
