# 参与贡献

在提交修改前，可以先通过仓库 Issue 描述使用场景、期望行为与复现步骤。界面问题请注明浏览器版本、操作系统、窗口宽度，以及当前处于示例预览还是 Chrome 扩展页面。

请使用公开示例或自行构造的测试数据复现。截图和附件应移除内部网址、账号参数、个人收藏和私人背景图片。

## 本地验证

项目使用原生 HTML、CSS、JavaScript，运行测试需要 Node.js 18+，构建需要 Python 3.7+。无需安装 npm 依赖。

```sh
npm test
npm run check
npm run build
npm run check:release
```

涉及界面交互的更改，应补充实际浏览器中的操作验证。涉及书签写入的更改，应使用独立浏览器测试资料验证撤销、失败重试和重新打开后的恢复。

修改集中在对应功能，沿用现有目录规则、两层分类和视觉样式。提交 Pull Request 时说明变更行为、验证结果与尚未验证的环境。新增网络访问应同步权限声明和 PRIVACY.md。

首次公开前持续完善 1.0.0。后续版本由维护者通过 `npm run version -- patch` 等命令统一递增。

更新说明维护在 `releases.js`，待发布功能放入 `upcoming`。公开发布时写入真实版本、日期和功能条目，并同步发布状态。运行 `npm run releases` 生成 CHANGELOG.md 及扩展版本显示名称。GitHub 草稿 Release 同样从 `releases.js` 提取当前版本说明。
