# 资管云课程队列管理助手

用于管理资管云课程访问顺序的 Tampermonkey 用户脚本。

## 功能
- 扫描当前页面可识别的课程链接并加入队列
- 手动加入当前课程
- 保存课程队列和当前队列位置
- 开始、停止队列任务
- 开启或关闭跨课程联播
- 仅在平台明确显示课程完成后，才自动进入队列下一门
- 手动切换到下一门课程

## 使用边界
本脚本只负责课程队列管理和页面导航，不修改视频播放进度、不模拟观看、不伪造学习记录，也不绕过平台的课程完成判定。请遵守所在机构及平台的课程学习要求。

## 安装
1. 在 Chrome 或 Edge 安装 Tampermonkey（篡改猴）。
2. 将 `course-manager.user.js` 上传到自己的 GitHub 公共仓库。
3. 打开 GitHub 上该文件的 **Raw** 页面。
4. Tampermonkey 通常会识别 `.user.js` 并显示安装页面，点击“安装”。

## 一键安装链接格式
将 `<GitHub用户名>` 替换为你的用户名：

`https://raw.githubusercontent.com/<GitHub用户名>/ziguanyun-course-manager/main/course-manager.user.js`

仓库名或分支名不同，请相应修改。

## 发布到 GitHub
1. 创建 Public 仓库，建议命名为 `ziguanyun-course-manager`。
2. 上传 `course-manager.user.js`、`README.md` 和 `LICENSE`。
3. 确认文件位于 `main` 分支根目录。
4. 将上面 Raw 链接分享给使用者。

## 更新
发布新版本时修改脚本头部的 `@version`，再提交到同一路径。用户可在 Tampermonkey 中检查更新。

## 兼容性
脚本依赖资管云网页当前显示的课程链接和完成提示。网站结构或提示文案变化时，相关识别功能可能需要更新。
