# dsh-3d-viewer

在 DSH 侧栏里直接打开 3D 模型：`.step` / `.stp` / `.stl` / `.glb` / `.gltf`。

> 为什么：CAD 的 STEP/STL 平时只能在 FreeCAD 里看；在 DSH 里聊到模型时，文件能直接在侧栏转起来，不用切窗口、不用转格式。

- **装了 [dsh-better-sidebar](https://github.com/omdsh-dev/DSH-better-sidebar)**：在它的文件树里双击模型文件，用 3D 视图打开（`registerFileViewer`）。
- **没装**：降级到 DSH 原生右侧栏文档预览（`documentPreviews` + `sidebar.right.tab.document`），同一个渲染器，不报错、不缺页。

STEP 用 `occt-import-js`（OpenCASCADE WASM）在浏览器里转网格；STL 与 GLB/GLTF 前端直接解析。**不依赖本机 Python/OCP，不写临时文件**。OpenCASCADE 的 wasm 已经内联进 `lib/client.js`（`wasmBinary` 传入），运行时不需要额外请求。

## 安装

```bash
# 在仓库根目录执行
dsh plugin --profile web add .
```

这条命令会同时把包写进 `dependencies` 和 `dsh.profile.bundles`（2026-11-03 在 DSH 0.2.1-rc.3 上实测：`pnpm add` 之后 bundles 自动多了 `dsh-3d-viewer`）。也可以在 Web 里「插件」→「添加插件」→ 本地目录填同一个路径。

`lib/client.js` 已构建并随目录提交，**装之前不需要 `npm install` 或构建**；`three` / `occt-import-js` 是 `devDependencies`，只给重新构建用，安装时不会带进 profile。

> 依赖版本：`dsh-better-sidebar` 请用 **0.28.x**。0.24.1 在 DSH 0.2.1 上会停在 `pending (waiting for service: webRuntime)` —— 那个服务在 0.2.1-rc.1 已改名为 `webStartup`。

## 用法

| 动作 | 操作 |
|---|---|
| 旋转 | 左键拖拽 |
| 缩放 | 滚轮 |
| 平移 | 右键拖拽 |
| 复位 | 双击画布 |
| 视图 | 工具条「适配 / 前 / 顶 / 侧 / 等轴」，全部正交投影 |
| 截图 | 工具条「截图」，存 PNG |
| 读数 | 底部一行：三角面数 · 包围盒（mm） |

## 验收

仓库自带一个 10 mm 立方体样例（`samples/cube-10mm.step` / `.stl`），下面的命令都基于它；换成自己的文件只需要把路径传进去。

`scripts/verify-step.mjs` 在 Node 里用**同一个库、同一个 `wasmBinary` 选项**解析：

```
$ node scripts/verify-step.mjs
file      samples/cube-10mm.step
meshes    1
triangles 12
bbox      10.00 x 10.00 x 10.00 mm
expected  10.00 x 10.00 x 10.00 mm (+/- 0.5)
max diff  0.000 mm
RESULT    PASS
```

也可以指向自己的文件：`node scripts/verify-step.mjs path/to/your.step`（只校包围盒，不校精确三角面数）。

浏览器侧同样验过：`scripts/smoke.html` 在无头 Chrome 里加载同一份解析代码，走内联 wasm 解析同一份 STEP：

```
PASS triangles=12 size=10.00 x 10.00 x 10.00
```

端到端渲染也验过：`scripts/render-smoke.html` 用真 React + 真 WebGL 把 `registerFileViewer` 注册到的那个组件挂起来，喂真实 STEP 字节：

```
RENDER PASS · canvas=900x544 · centerPainted=true · 12 三角面 · 10.00 × 10.00 × 10.00 mm
```

STL / GLB 用 `scripts/model-smoke.html` 跑真文件（同一份 bundle、真 React + 真 WebGL；不带参数默认跑 STL 样例）：

```
$ node scripts/run-headless.mjs "http://127.0.0.1:8098/scripts/model-smoke.html"
PASS · cube-10mm.stl · canvas=900x504 · centerPainted=true · 12 三角面 · 10.00 × 10.00 × 10.00 mm
```

GLB 用 `?file=` 指到你自己的文件，例如：

```
$ node scripts/run-headless.mjs "http://127.0.0.1:8098/scripts/model-smoke.html?file=../models/model.glb"
PASS · model.glb · ...
```

截图在 `docs/stl-acceptance.png` 与 `docs/glb-acceptance.png`；后者用的是 three.js 示例模型 `LeePerrySmith.glb`（不在仓库里）。GLB 这条第一次跑出来人头是躺着的 —— 原实现对所有格式都套了 CAD 的 Z-up → Y-up 旋转（`wrapper.rotation.x = -90°`），而 glTF 按规范已经是 Y-up。已改成只对 STEP/STL 旋转（`zUp` 标记），重跑后头是正的。

复现（**必须用真实时间跑**）：

```bash
npm run build:smoke          # 重新生成 smoke.bundle.js
python3 -m http.server 8098  # 在仓库根目录
# 无头 Chrome 由脚本自己拉起（CDP 轮询，不依赖 Playwright）：
node scripts/run-headless.mjs "http://127.0.0.1:8098/scripts/render-smoke.html" --shot /tmp/step.png
node scripts/run-headless.mjs "http://127.0.0.1:8098/scripts/model-smoke.html"
```

> 坑：`--virtual-time-budget + --dump-dom` 会在 OpenCASCADE 的 wasm 编译期间就把虚拟时间耗光，页面停在「解析中…」，看起来像解析卡死 —— 实际是测量方式的问题。真实时间下（CDP 轮询）两个页面都 PASS。

### 真实 GUI 验收（2026-11-03，隔离 profile）

用 `dsh --profile <临时 profile> --from-default-profile web` 建了一个独立 profile（`dsh-better-sidebar@0.28.0` + 本插件，独立端口），不碰日常 profile：

- 启动无告警，boot payload 里 `dsh-3d-viewer` 与 `dsh-better-sidebar` 都在
- 右侧栏「文件」树 → 任意 `.step` 单击 → 新 tab
- tab 内渲染出模型，工具条「适配 / 前 / 顶 / 侧 / 等轴 / 截图」在位
- 底部读数：三角面数 · 包围盒
- 控制台无 error / warning

这次真机验收抓到一个离线测不出的 bug，已修：`registerNative` 直接读 `ctx.documentPreviews`，Cordis 会抛 `cannot get property "documentPreviews" without inject`，导致**原生降级那一路从来没注册成功过**（better-sidebar 那一路正常）。现在两路都走 `ctx.inject([...], cb)` 子 fiber，服务不存在时只跳过自己那一路。

## 文件

| 文件 | 职责 |
|---|---|
| `src/client.js` | 入口：`window.__ModuleLoader__.load({ id, factory })`，只从 `require` 取 `react` |
| `src/module.js` | 两套注册：better-sidebar 文件预览器 + 原生文档预览；都包在 try/catch 里软降级 |
| `src/body.js` | React 组件（工具条 / 画布 / 底部读数），React 由外部注入 |
| `src/viewer.js` | three.js 渲染器、正交相机、四种视图、STL/GLTF/STEP 解析 |
| `lib/client.js` | 构建产物（10.3 MB，含内联的 three 与 OCCT wasm），**提交进目录** |
| `index.js` | host 半，空 `apply()` |
| `cordis.patch.yml` | bundle 的 `insert:` 一行 |
| `locale/{zh,en}.json` | 插件名与说明 |
| `icon.svg` | 插件图标 |
| `scripts/build.mjs` | esbuild 构建（`--loader:.wasm=binary`、`--external:fs --external:path`） |
| `scripts/verify-step.mjs` | Node 侧 STEP 验收 |
| `scripts/smoke{,-entry}.js` + `smoke.html` | 浏览器侧解析验收（内联 wasm 走真实浏览器） |
| `scripts/render-smoke.html` | 端到端渲染验收：真 React + 真 WebGL 挂载组件并喂真实 STEP |
| `scripts/model-smoke.html` | STL / GLB 真文件渲染验收（`?file=` 指定，默认 `../samples/cube-10mm.stl`） |
| `scripts/run-headless.mjs` | 无依赖 CDP 驱动：拉起无头 Chrome、等 `#out` 出结果、可选截图 |
| `scripts/vendor/` | 离线验收页用的 React 18.2 UMD（MIT，非插件依赖） |
| `samples/` | 10 mm 立方体样例（STEP + STL），验收与示例用 |

## 构建

```bash
npm run build     # 产出 lib/client.js
```

`fs` / `path` 被标成 external：它们只出现在 emscripten 的 node-only 分支里，浏览器不会执行到；不标会让 esbuild 因为 Node 内建模块报错。

## 没验证的部分

- **原生降级路径的实际观感**：注册链路已修好（见上），但隔离 profile 里装了 better-sidebar，`content.kind === 'bytes'` 的取字节没在「没有 better-sidebar」的 profile 里真跑过。
- **压缩过的 GLB/GLTF**：只验过未压缩的 `LeePerrySmith.glb`；带 DRACO / KTX2 压缩的模型会失败（没接解码器）。
- **深色主题适配**：画布背景写死 `#11161c`，不跟随宿主主题（宿主切浅色时面板仍是深色）。
- **单位**：底部读数一律写 `mm` —— 对 STEP/STL 成立；glTF 规范没有单位，那串数字只是模型空间尺寸。
- **其它 DSH 版本**：只在 0.2.1-rc.3 + better-sidebar 0.28.0 上验过。
