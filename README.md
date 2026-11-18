# GRASE · Scene Studio

真实空间重建结果的 GitHub Pages 展示站。

**网站：<https://ivy-vivi.github.io/long-horizon-real2sim/>**

场景生成、2K、Shell 蒸馏和 zican 四个集合共用搜索、状态筛选、缩略图、大图和键盘浏览。项目进度展示发布时的每日完成记录和各集合的结果覆盖。

## 发布内容

- 每个场景最多 10 张对比图。优先使用可匹配的相机位置、朝向和序列跨度做最远点采样；缺少相机记录时沿完整序列分散选取。不足 10 张时保留已有图片。
- Shell 的每组场景 / 结构图合成为一张配对图，保留 5 组视角和整体剖视。
- zican 展示最新有图轮次的对比图，列出归档轮次。嵌套的单独渲染图不重复进入图库。
- 已成功的场景修订保留在最多 10 张图的总预算内。图片转换为 WebP，完整保留对照面板和原图标注；最大尺寸 1920 × 1440，另生成小缩略图。
- 页面明确标记快照时间。“迭代结束 · 轮数上限”不等同于审核通过。

原有动态网页继续独立运行。本仓库的导出器只读取接口、结果和相机文件，不改写、重启或停止原站。公开内容是静态快照，不提供任务派发、修改申请、管理员审批或原始模型下载。

## 本地预览

```bash
python -m http.server 8877 --directory docs
```

打开 `http://localhost:8877/`。所有资源采用相对路径，可部署到 GitHub Pages 项目子路径。

## 更新结果

在能读取源工程及运行站点的机器上安装 Pillow，然后运行：

```bash
python tools/export_gallery.py --source-root /path/to/source-project --source-url http://gallery-host:port
python tools/check_export.py
git add docs
git commit -m "Refresh gallery snapshot"
git push
```

导出器在 `.local/` 中保存私有源目录快照与媒体索引，该目录已被 Git 忽略。导出过程对展示字段使用白名单；源路径、对话标识、内部任务记录、修改申请和访问凭据不会复制到公开目录。图片重新编码，不保留原始 EXIF。

GitHub Pages 配置为 `main` 分支的 `/docs` 目录。推送后的 Pages 构建成功即可更新网站，无需后端或构建依赖。

## 验证

```bash
python tools/check_export.py
python -m unittest discover -s tools -p 'test_*.py'
node --check docs/assets/app.js
PLAYWRIGHT_MODULE=/path/to/playwright CHROMIUM_PATH=/path/to/chromium node tools/check_browser.cjs
```

浏览器检查使用临时 HTTP 服务，模拟 `/long-horizon-real2sim/` 子路径，验证分类、搜索、空场景、大图、历史导航、进度与手机布局。

视觉布局参考 [Westlake Flora Lab](https://raconiy.github.io/westlake-flora-lab/#progress) 的浅色底、绿色点缀与进度记录形式。页面代码独立实现，展示图来自现有 GRASE 结果。
