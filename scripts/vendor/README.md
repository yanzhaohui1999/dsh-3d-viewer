# vendored React UMD

`react.production.min.js` / `react-dom.production.min.js` 是 React **18.2.0** 的官方 UMD 构建（MIT，版权头保留在文件内）。
只给 `smoke.html` / `render-smoke.html` / `model-smoke.html` 这几个离线验收页用 —— 让它们不依赖本机其它插件的 `node_modules`，也不需要联网。

插件本体不加载这两个文件：真正的 React 由 DSH 宿主注入。
