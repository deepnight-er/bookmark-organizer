---
name: "书签整理"
description: "桌面收藏管理工具的源码设计记录"
colors:
  canvas: "#f3f2ef"
  surface: "#fffefa"
  sidebar: "#eeede9"
  panel: "#f8f7f3"
  text: "#252522"
  muted: "#686760"
  line: "#ddddd5"
  soft-line: "#eae9e2"
  hover: "#f0efe9"
  selected: "#e7e7e0"
  accent: "#353c49"
  on-accent: "#fff"
  danger: "#ad3f32"
  danger-soft: "#faeee9"
  field: "#fffefa"
  dark-canvas: "#1b1c1c"
  dark-surface: "#232524"
  dark-sidebar: "#1d1f1e"
  dark-panel: "#202221"
  dark-text: "#e9e9e1"
  dark-muted: "#a2a69e"
  dark-line: "#3c403b"
  dark-soft-line: "#323630"
  dark-hover: "#2d312c"
  dark-selected: "#393f38"
  dark-accent: "#d1d7df"
  dark-on-accent: "#202528"
  dark-danger: "#f0a090"
  dark-danger-soft: "#49322d"
  dark-field: "#272b27"
  accent-blue: "#3458a4"
  accent-rust: "#a34b31"
  accent-teal: "#27716f"
  dark-accent-blue: "#abc5ff"
  dark-accent-rust: "#efb198"
  dark-accent-teal: "#98d0c8"
typography:
  headline:
    fontFamily: "\"DM Sans\", \"PingFang SC\", \"Microsoft YaHei\", sans-serif"
    fontSize: "25px"
    fontWeight: 620
    lineHeight: 1.4
    letterSpacing: "-.025em"
  app-title:
    fontFamily: "\"DM Sans\", \"PingFang SC\", \"Microsoft YaHei\", sans-serif"
    fontSize: "17px"
    fontWeight: 650
    letterSpacing: ".02em"
  bookmark-title:
    fontFamily: "\"DM Sans\", \"PingFang SC\", \"Microsoft YaHei\", sans-serif"
    fontSize: "14px"
    fontWeight: 520
    lineHeight: 1.4
  button-label:
    fontFamily: "\"DM Sans\", \"PingFang SC\", \"Microsoft YaHei\", sans-serif"
    fontSize: "12px"
    lineHeight: "18px"
  metadata:
    fontFamily: "\"DM Sans\", \"PingFang SC\", \"Microsoft YaHei\", sans-serif"
    fontSize: "11px"
    lineHeight: 1.5
rounded:
  tag: "3px"
  control: "4px"
  button: "5px"
  toast: "6px"
  menu: "7px"
  panel: "8px"
  dialog: "10px"
spacing:
  xs: "4px"
  sm: "6px"
  md: "8px"
  control-gap: "10px"
  lg: "12px"
  xl: "14px"
  section: "18px"
  pane: "20px"
  header: "24px"
  content: "28px"
  wide-content: "36px"
components:
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.on-accent}"
    rounded: "{rounded.button}"
    typography: "{typography.button-label}"
    padding: "6px 11px"
  button-quiet:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    rounded: "{rounded.button}"
    padding: "6px 11px"
  button-danger:
    backgroundColor: "{colors.danger}"
    textColor: "{colors.surface}"
    rounded: "{rounded.button}"
    padding: "6px 11px"
  button-text:
    textColor: "{colors.accent}"
    padding: "5px 0"
  button-icon:
    textColor: "{colors.muted}"
    rounded: "{rounded.control}"
    width: "28px"
    height: "28px"
    padding: "5px"
  search-field:
    backgroundColor: "{colors.panel}"
    rounded: "{rounded.button}"
    padding: "0 11px"
  source-navigation:
    textColor: "{colors.text}"
    rounded: "{rounded.control}"
    padding: "10px 12px"
  prefix-tag:
    textColor: "{colors.muted}"
    rounded: "{rounded.tag}"
    padding: "1px 5px"
  bookmark-row:
    padding: "12px 13px"
  category-directory-row:
    textColor: "{colors.text}"
    padding: "7px 5px"
  bookmark-connection-view:
    textColor: "{colors.text}"
    padding: "26px 28px"
---

# Design System: 书签整理

## Overview

暖白内容区、石墨文字和细分隔线构成主界面。日常浏览时，来源分类、书签列表与移动目标分别占据独立窗格，列表保留名称、前缀、路径、域名和行内动作。分类整理与接入说明各自占用内容视图，切换时收起书签列表和右侧移动目标。

外观设置提供浅色、深色及跟随系统，四种强调色与两种列表密度。背景图片显示在窗格外围，内容表面保持可读。记录依据当前源码，范围为视觉与交互规则，真实 Chrome 安装仍待验证。

- 连续列表与细分隔线。
- 名称和网址在行内编辑。
- 分类以可展开的两层目录操作，改名、新建与合并目标跟随所在行。
- 页头持续显示当前数据来源，接入说明使用独立内容视图。
- 色彩通过主题变量集中切换。
- 窄窗口通过收起窗格保留操作入口。

## Colors

颜色值以 frontmatter 为准，与 `styles.css` 的同名变量对应。`dark-` 前缀记录深色覆盖值，强调色变体对应 `data-accent`。

### Primary

石墨是默认强调色，用于主要动作、文本动作、选框、插入光标、选区及焦点轮廓。靛蓝、陶土、青灰以相同语义替换强调色。深色主题同步替换强调色及按钮前景色。

### Neutral

暖白内容表面、灰米色来源栏与浅灰辅助面板共同构成浅色主题。深色主题使用带轻微绿调的近黑表面。`text` 承担名称与标题，`muted` 承担路径、域名、数量与说明，`line` 用于窗格和控件边框，`soft-line` 用于列表行分隔。`hover` 与 `selected` 分别表达指向和已选状态。

危险动作使用 `danger`，错误通知与危险图标悬停使用 `danger-soft`。品牌书签轮廓固定使用陶土色，是代码中的单独值。强调色色板显示浅色方案色样，深色主题中的实际强调色由变量覆盖。

## Typography

字体从 `assets/DM-Sans.ttf` 本机加载，字重范围（100–1000），加载策略为 `swap`。中文依序使用 PingFang SC、Microsoft YaHei 和系统无衬线字体。全局禁止合成字体，默认字号（14px）。

标题与列表正文共用一套字体。主内容标题、应用名称、书签名称、按钮和元信息的字号字重由 frontmatter 记录。导航字号（13px），对话框标题（18px，600），外观面板标题（15px，600）。紧凑列表名称调整为（13px / 18px），元信息行高（15px）。数量使用等宽数字，路径和网址使用省略号处理溢出。快捷键与代码片段沿用界面字体。

## Layout

桌面主体使用三栏网格（212px / minmax(380px, 1fr) / 288px），顶栏最小高度（62px）。页面占满视口，主体禁止整体滚动，来源导航、书签列表与目标文件夹各自滚动。内容标题、搜索框、批量工具栏与页脚共享横向对齐线（28px）。列表容器横向留白（15px）叠加列表行内边距（13px）。

- 宽度至少（1600px）时，三栏改为（230px / minmax(480px, 1fr) / 310px），主要对齐留白增至（36px）。
- 宽度至多（1150px）时，三栏改为（180px / minmax(300px, 1fr) / 250px），主要留白减为（20px），保存状态文字收起。
- 宽度至多（900px）时，左栏（174px）与弹性列表组成两栏，移动目标通过“移到分类”打开固定右侧窗格（288px）。
- 宽度至多（650px）时，来源栏收起并出现分类下拉框，顶栏最小高度（100px），内容标题字号（22px），拖动手柄收起，行内编辑左缩进归零。
- 宽度至多（400px）时，应用名称字号（15px），主要留白减为（15px）。


分类整理与接入说明使用来源栏加弹性内容区的两栏布局（212px / minmax(0, 1fr)），至多（1150px）和（900px）时来源栏分别为（180px）和（174px），至多（650px）时来源栏按窄窗口规则收起。整理视图的标题、tab 和内容区最大宽度（900px），内容区独立滚动。接入视图整体滚动。两种视图基础内边距（26px 28px），横向留白在宽屏增至（36px），至多（1150px）时减为（20px），至多（650px）时上留白减为（20px）。返回后恢复正常书签视图。

页头身份文字在所有断点可见。普通网页显示“示例预览”，真实扩展数据源显示“Chrome 书签”。顶部“整理”和“使用我的书签”分别进入对应内容视图，保留明确的返回入口。

舒适与紧凑列表最小行高分别为（68px）和（51px），行内容允许撑高。紧凑模式只改变行高、上下内边距和标题元信息尺寸。

本机背景图片以 `cover` 居中铺在页面背景。启用后工作区外围留白（18px），窗格间隙（1px），窗格边框移除。窄至（650px）时外围留白（8px）。背景支持 PNG、JPEG、WebP，最大（2 MB），保存在本机。

## Elevation & Depth

主体窗格与普通控件通过底色和细边框建立层次。阴影集中在临时反馈、对话框和收起后的目标窗格。外观面板和导出菜单使用描边。

- 提示条阴影（`0 8px 25px #0002`）。
- 对话框阴影（`0 18px 70px #0004`），背景遮罩（`#16171470`）。
- 窄窗口目标窗格阴影（`-12px 0 28px #0002`）。

按钮背景色过渡（120ms ease-out）。系统请求减少动态效果时，关闭过渡并恢复自动滚动行为。

## Shapes

重复控件使用小圆角，标签、输入框、按钮、菜单、外观面板及对话框的半径依次记录在 frontmatter。主要边框和分隔线宽度（1px）。图标为线性 SVG，常规尺寸（17px × 17px），线宽（1.5），端点和拐角为圆形。强调色选择使用圆形色样，外圈尺寸（30px），实际色样（20px）。

## Components

### Buttons

主要、安静和危险按钮共用最小高度（32px）、内边距（6px 11px）及字号（12px / 18px）。主要按钮使用强调色底与 `on-accent` 前景，悬停亮度为（.92）。安静按钮使用内容表面和细描边，悬停切换到 `hover`。危险按钮使用危险色底与表面色文字。文字按钮使用强调色文字，悬停显示下划线。图标按钮为（28px × 28px），悬停出现底色。禁用按钮透明度（.45）并恢复默认指针。

### Inputs / Fields

常规输入使用字段表面、细描边、小圆角和内边距（8px 9px）。搜索框最小高度（36px），输入内部去除边框，外层 `focus-within` 切换强调色描边。占位文字使用 `muted`。错误文字使用危险色，普通编辑反馈使用强调色。复选框尺寸（13px × 13px），勾选颜色跟随强调色。

### Navigation

来源分类使用整行按钮，横向内边距（12px）、纵向内边距（10px），名称可省略，数量右对齐。激活项使用选择底色和较重字重。二级分类为可换行的筛选项，激活时同时使用底色与细描边。二级筛选默认最大高度（72px），超出部分滚动，并保留展开入口。

### Prefix Tags

前缀标签跟随名称展示，使用弱文字、细描边与小圆角，最大宽度（12ch）。名称和前缀分别省略，元信息中的路径最大宽度（54%）。

### Bookmark Rows

列表行通过细底线连续排列。悬停显示辅助面板底色，选中显示选择底色。名称、元信息和行内图标保持对齐。编辑时原行换行，字段网格为（100px / minmax(0, 1fr)），网址占满两列。

**The Inline Editing Rule.** 书签名称和网址的编辑器在原列表行展开，保存与取消动作跟随字段。

拖动时原行透明度（.35），指针切换为抓取状态，拖动数量随指针展示。进入可投放目标时出现内缩强调色轮廓（2px）和选择底色。拖拽之外，保留勾选后批量移动入口。

### Empty Folder States

**The Empty Folder State Rule.** 书签数为零且仍有下级目录时，未搜索的空状态同时显示书签数、空子文件夹数和直接子文件夹名称，并提供管理入口。

空状态沿用居中的列表提示布局。包含空子文件夹时，标题提示分类包含空文件夹，说明明确“当前范围 0 条书签”及空子文件夹数量，随后列出直接子文件夹名称。“管理文件夹”复用安静按钮，进入分类管理并展开所在一级分类。搜索无结果时使用匹配提示。

空子文件夹数量统计当前分类下的后代文件夹，并扣除所选分类自身。名称说明沿用弱文字（12px / 1.8），长名称允许任意位置换行，管理按钮与上方内容间距（12px）。

### Floating Controls and Dialogs

外观面板固定在右上方，宽度（302px），内边距（19px），最大高度随视口调整并可滚动。主题使用分段单选，密度使用下拉，强调色使用单选色样。打开面板后焦点进入当前主题，关闭按钮或 Escape 将焦点还给入口，点击或聚焦外部会关闭面板。

导出菜单与外观面板通过 `aria-expanded` 反映开关状态。删除和合并确认使用原生 `dialog`，取消按钮默认获焦，显示受影响分类及书签数量。确认框宽度（410px），最大宽度为视口减（32px）。提示条带 `role=status` 和礼貌播报，支持撤销和关闭。


**The Deletion Scope Rule.** 删除确认分别展示书签与文件夹数量，列明所选目录及其下级目录，零书签范围使用空文件夹文案。

文件夹数量包含所选目录自身及所有下级目录。确认框内的名单最多列出（20）个文件夹名称，超出时追加剩余数量提示，使用弱文字（13px / 1.8），左缩进（20px），最大高度（160px）并可滚动。空目录确认说明将删除的空文件夹数，补充范围内共（0）条书签，同时保留当前数据源的写入说明及撤销说明。

**The Visible Focus Rule.** 可交互控件保留强调色焦点提示，搜索输入通过外层边框显示焦点。

通用 `focus-visible` 使用强调色外轮廓（2px），偏移（2px）。分段选择的标签和图片选择按钮在内部控件获焦时显示外层轮廓。搜索快捷键为 Cmd/Ctrl+K，非输入状态 Cmd/Ctrl+Z 撤销，Escape 退出编辑、关闭目标窗格或菜单并清除拖动状态。

### Category Directory

“整理”进入独立目录操作模式，三个 tab 分别为“分类管理”“查找重复”“导入备份”。当前 tab 使用强调色底线（2px）、正文色与较重字重，其余项使用弱文字。打开时焦点进入当前 tab，左右方向键、Home 和 End 切换项目，“返回书签”将焦点还给顶部入口。

分类管理以一级目录行和缩进的二级目录组成。一级行最小高度（54px），二级行（44px），列表使用细底线，二级目录用左侧细线连接。一级名称字号（14px，550），二级名称（13px，400），数量使用（12px）等宽数字。指向或行内控件获焦时显示辅助面板底色。展开按钮通过 `aria-expanded` 反映状态，展开箭头旋转（90deg）。

二级目录行在书签计数为零且仍有下级目录时，名称下显示“含 N 个空子目录”。该注记使用弱文字（11px / 1.6，400）和上间距（2px），右侧仍保留独立的书签数量。

一级名称旁提供加号新建二级，每行提供铅笔改名和更多入口。改名或新建时，字段与保存、取消图标在对应位置展开，字段采用 `field` 底色、细描边与控件圆角。Enter 提交，Escape 取消，打开编辑器后名称字段获焦并选中文本。更多动作在当前行下展开，包括上移、下移、合并与删除，边界方向的移动按钮禁用。

选择“合并到…”后，同级目标列表在来源行下展开。目标区使用辅助面板底色、细描边和控件圆角，选定目标后通过确认框显示来源、目标与受影响数量。分类删除使用已有范围确认与撤销反馈。

目录拖动使用行内手柄，原行透明度（.45），目标行前后以强调色插入线（2px）标记落点。同层目录可调整顺序，二级目录的拖动范围限定在同一一级目录内。至多（650px）时收起拖动手柄，保留更多菜单中的上下移动，减少目录缩进，编辑位置选择可独占一行。

### Bookmark Connection View

“使用我的书签”打开独立接入内容视图。标题沿用主内容标题字阶，说明文字使用弱文字色和行高（1.8），简介宽度上限（60ch），正文与步骤宽度上限（65ch）。“已经安装过”优先展示，区块以细分隔线组织。首次安装使用原生 `details`，默认收起，展开后显示扩展包下载与安装步骤。

复制扩展管理页地址使用安静按钮并给出提示反馈，下载动作复用主要按钮。HTTP / HTTPS 预览中下载链接指向 `download/extension.zip`，其他页面协议显示本机构建取包说明。进入时焦点落在“返回预览”，返回后焦点恢复到“使用我的书签”。

源码在首次安装事件中请求打开书签页，扩展图标优先聚焦已存在页面。此处记录实现与界面说明，真实 Chrome 安装、重载和跨设备效果仍待目标环境验证。

## Do's and Don'ts

### Do

- Do 沿用语义颜色变量，让主题与强调色共同作用于控件状态。
- Do 用细分隔线、字重和表面色区分列表层级。
- Do 为批量动作显示当前选择范围，并保留撤销反馈。

### Don't

- Don't 将行内编辑改为跳离列表的独立编辑页。
- Don't 在紧凑密度中隐藏保存、取消或删除入口。
- Don't 将背景图片作为输入字段和正文的直接底色。

记录依据为 `styles.css`、`index.html`、`appearance.js`、`app.js`、`core.js`、`background.js`、`README.md` 与 `PRODUCT.md`。2.2.0 的目录操作模式、独立接入视图、断点、键盘路径和焦点规则，以及 2.2.1 的空目录状态和删除范围名单已通过源码核对。本次文档更新未操作浏览器，真实 Chrome 安装、重载和跨设备效果仍待验证。
