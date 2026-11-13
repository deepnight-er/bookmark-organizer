# 参与贡献

在提交修改前，可以先通过仓库 Issue 描述使用场景、期望行为与复现步骤。界面问题请注明浏览器版本、操作系统、窗口宽度，以及当前处于示例预览还是 Chrome 扩展页面。

请使用公开示例或自行构造的测试数据复现。截图和附件应移除内部网址、账号参数、个人收藏和私人背景图片。

## 开发与预览

项目使用原生 HTML、CSS、JavaScript，需要 Node.js 18+ 和 Python 3.7+，建议使用受维护的版本。无需安装 npm 依赖。

```sh
npm run build
npm run preview
```

打开终端输出的本机地址。网页预览使用公开示例，体验草稿存于当前网页来源的 `localStorage`。预览服务中的扩展下载使用本次构建生成的安装包。

## 验证与打包

```sh
npm test
npm run check
npm run build
npm run check:release
```

涉及界面交互的更改，应补充实际浏览器中的操作验证。涉及书签写入的更改，应使用独立浏览器测试资料验证撤销、失败重试和重新打开后的恢复。

修改集中在对应功能，沿用现有目录规则、两层分类和视觉样式。提交 Pull Request 时说明变更行为、验证结果与尚未验证的环境。新增网络访问应同步权限声明和 PRIVACY.md。

构建在 `dist/` 中生成扩展 ZIP、Chrome 商店 ZIP、源码 ZIP 和单文件预览。手动加载使用 `-extension.zip` 中的 `extension` 文件夹，商店上传使用根目录包含 `manifest.json` 的 `-webstore.zip`。两种安装包包含相同运行文件，源码包附带脚本和文档，压缩包采用固定元数据，支持重复构建。新增运行资源需同时更新 `package.json` 的 `files`，新增示例域名需更新 `scripts/check.cjs` 中的允许清单。

## 更新本地扩展

```sh
npm run build:local
npm run check:local
```

`build:local` 从同一源码生成发行文件和本地运行目录，默认目录为 `dist/local/extension`。需要沿用已有加载路径时，在 `private/local-targets.json` 中配置相对于源码目录的 `extensionDirectory`，以及可选的 `htmlFile` 和 `archiveFile`。该配置位于 Git 忽略目录。

`check:local` 逐字节对比本地运行目录与全部运行源码。更新后在 Chrome 扩展管理页点击“重新加载”，再刷新书签页。在“外观”中核对实际页面版本。

Chrome 书签由 `chrome.bookmarks` 管理，撤销快照存于 `chrome.storage.local`。沿用原加载路径有利于保留扩展的本机设置和历史。个人导出文件应放在源码目录之外。

兼容旧运行目录时，构建脚本会把其中内嵌的非示例书签保存至相邻 `bookmark-organizer-private/history` 目录。历史 JSON 保存生成时的快照，最新收藏以 Chrome 书签为准。

## 源码结构

| 文件 | 职责 |
|---|---|
| `index.html`、`styles.css` | 页面结构与样式 |
| `app.js` | 交互流程 |
| `core.js` | 目录及数据规则 |
| `adapter.js` | 浏览器与示例数据适配 |
| `i18n.js`、`translations.js` | 语言匹配与词条 |
| `page-tools.js` | 网页标题读取 |
| `appearance.js` | 外观设置 |
| `releases.js` | 版本状态及更新记录 |

## 版本与发布

`package.json` 是版本号来源。维护者通过版本命令统一更新扩展清单、页面及版本记录。

```sh
npm run version -- patch
npm run version -- minor
npm run version -- major
```

修复、内容和样式小改使用 patch，新增功能使用 minor，存在不兼容变化时使用 major。可以在 main 持续迭代，在准备交付一批更改时统一递增版本。

更新说明维护在 `releases.js`，待发布功能放入 `upcoming`。正式发布时，把该版的真实版本、日期和功能条目写入 `published`，将 `stage` 设为 `published`。运行 `npm run releases` 生成 CHANGELOG.md 及扩展版本显示名称。页面会随状态切换为正式版本，GitHub 草稿 Release 同样从 `releases.js` 提取当前版本说明。

main 更新及 Pull Request 会触发 Linux、Windows 的测试、检查、构建和发行文件核对。与 `package.json` 一致的 `v版本号` 标签会触发草稿 Release 工作流，附件包含扩展包、Chrome 商店包、源码包和单文件预览。维护者核对附件、更新记录与兼容结果后发布。

对外发布前，维护者应核对安装步骤、扩展权限、截图与安全反馈入口，并按需要配置 GitHub 私密漏洞报告。配置方法见 [GitHub 官方说明](https://docs.github.com/en/code-security/how-tos/report-and-fix-vulnerabilities/configure-vulnerability-reporting/configure-for-a-repository)。

## 待补充验证

- 第二台真实设备上的账号同步。
- Chrome 跨版本升级及 Edge、Firefox 适配。
- 各语言的母语校对与较长文案精修。
- 实际版本标签触发的草稿 Release 流程。

已完成的测试范围见[兼容与验证](docs/ACCEPTANCE.md)。
