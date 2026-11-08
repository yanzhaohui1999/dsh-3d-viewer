# dsh-3d-viewer

在 DSH 侧栏里直接打开 3D 模型：`.step` / `.stp` / `.stl` / `.glb` / `.gltf`。

> 为什么：CAD 的 STEP/STL 平时只能在 FreeCAD 里看；在 DSH 里聊到模型时，文件能直接在侧栏转起来，不用切窗口、不用转格式。

- **装了 [dsh-better-sidebar](https://github.com/omdsh-dev/DSH-better-sidebar)**：在它的文件树里双击模型文件，用 3D 视图打开（`registerFileViewer`）。
- **没装**：降级到 DSH 原生右侧栏文档预览（`documentPreviews` + `sidebar.right.tab.document`），同一个渲染器，不报错、不缺页。

STEP 用 `occt-import-js`（OpenCASCADE WASM）在浏览器里转网格；STL 与 GLB/GLTF 前端直接解析。**不依赖本机 Python/OCP，不写临时文件**。OpenCASCADE 的 wasm 已经内联进 `lib/client.js`（`wasmBinary` 传入），运行时不需要额外请求。

`.gltf` 只接受自包含文件：`buffers` / `images` 里的 `uri` 必须是内嵌的 `data:` URI。引用外部 `.bin` 或贴图的 `.gltf` 会被拒绝并提示，避免以 DSH 页面同源身份去请求任意地址；`.glb` 不受影响。

WebGL 上下文丢失（GPU 复位、驱动回收、标签页休眠）时会取消默认行为，恢复后重建渲染器并重新挂载模型，画布不会停在黑屏。

## 语言

工具栏、状态行、插件标题，以及「空文件 / 不支持 WebGL」提示支持中文与英文：装了 DSH 的 locale 服务时跟随宿主语言（设置 → 通用），没有宿主时按浏览器语言（`zh*` 用中文，其余用英文）；宿主语言切换后，新打开的预览使用新文案。解析器抛出的错误信息（STEP / STL / glTF）目前仍是中文诊断文本，见「没验证的部分」。

## 安装

```bash
# 在仓库根目录执行
dsh plugin --profile web add .
```

这条命令会同时把包写进 `dependencies` 和 `dsh.profile.bundles`（2026-11-03 在 DSH 0.2.1-rc.3 上实测：`pnpm add` 之后 bundles 自动多了 `dsh-3d-viewer`）。也可以在 Web 里「插件」→「添加插件」→ 本地目录填同一个路径。

`lib/client.js` 已构建并随目录提交，**装之前不需要 `npm install` 或构建**；`three` / `occt-import-js` / `esbuild` 是 `devDependencies`，只给重新构建用，安装时不会带进 profile。

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
RENDER PASS · canvas=900x544 · litRatio=0.4060 · maxDelta=156 · 12 三角面 · 10.00 × 10.00 × 10.00 mm
```

STL / GLB 用 `scripts/model-smoke.html` 跑真文件（同一份 bundle、真 React + 真 WebGL；不带参数默认跑 STL 样例）：

```
$ node scripts/run-headless.mjs "http://127.0.0.1:8098/scripts/model-smoke.html"
PASS · cube-10mm.stl · canvas=900x504 · litRatio=0.3769 · maxDelta=156 · 12 三角面 · 10.00 × 10.00 × 10.00 mm
```

`litRatio` 是按画布全像素统计的「与背景色不同的像素占比」；空白画布约为 0，旧版 8×8 `centerPainted` 阈值会把空白页也判 PASS。

GLB 用 `?file=` 指到你自己的文件，例如：

```
$ node scripts/run-headless.mjs "http://127.0.0.1:8098/scripts/model-smoke.html?file=../models/model.glb"
PASS · model.glb · ...
```

`?cube=<size>` 在页面里生成对应边长的 STL 立方体，`?mode=renamed-glb` / `?mode=external-glb` 在内存里构造带外部 URI 的 JSON glTF / GLB 容器；后两者用来验证「按内容拒绝外部 URI 且不发起请求」，输出里会带 `scene.bin requests=0` / `texture.png requests=0`。

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
>
> 无头驱动默认可执行文件是 macOS 的 Google Chrome；Chrome 装在别处或换系统时用 `CHROME_PATH=/path/to/chrome` 指定。调试端口交给系统分配（`--remote-debugging-port=0`，端口号从 profile 的 `DevToolsActivePort` 读取），脚本结束会删掉临时 profile，不再在 `/tmp` 残留 `dsh3d-chrome-*`。

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
| `src/body.js` | React 组件（工具条 / 画布 / 底部读数），React 与翻译函数由外部注入 |
| `src/i18n.js` | 从 `locale/*.json` 取 UI 词表；注册宿主 locale 失败时回退到本地翻译 |
| `src/viewer.js` | three.js 渲染器、正交相机、四种视图、STL/GLTF/STEP 解析、WebGL 上下文恢复 |
| `src/context.js` | 纯逻辑的 `webglcontextlost` / `webglcontextrestored` 绑定（取消默认行为 + 可测） |
| `src/format.js` | 纯路径辅助（`extOf`），不依赖 three/wasm，供 Node 单测直接 import |
| `lib/client.js` | 构建产物（10.3 MB，含内联的 three 与 OCCT wasm），**提交进目录** |
| `licenses/` | 随包分发的第三方许可文本（OCCT / occt-import-js，LGPL-2.1） |
| `index.js` | host 半，空 `apply()` |
| `cordis.patch.yml` | bundle 的 `insert:` 一行 |
| `locale/{zh,en}.json` | 插件名、说明与 UI 文案（`meta` + `ui`） |
| `icon.svg` | 插件图标 |
| `scripts/build.mjs` | esbuild 构建（`--loader:.wasm=binary`、`--external:fs --external:path`） |
| `scripts/verify-step.mjs` | Node 侧 STEP 验收 |
| `scripts/test-extof.mjs` | `extOf` 单测（纯 Node，`npm test`） |
| `scripts/test-context.mjs` | WebGL 上下文丢失/恢复事件绑定单测（模拟 canvas，无 GPU） |
| `scripts/test-i18n.mjs` | locale 词表一致性、语言选择与宿主/本地回退单测 |
| `scripts/smoke{,-entry}.js` + `smoke.html` | 浏览器侧解析验收（内联 wasm 走真实浏览器） |
| `scripts/render-smoke.html` | 端到端渲染验收：真 React + 真 WebGL 挂载组件并喂真实 STEP |
| `scripts/model-smoke.html` | STL / GLB 真文件渲染验收（`?file=` 指定，默认 `../samples/cube-10mm.stl`） |
| `scripts/run-headless.mjs` | 无依赖 CDP 驱动：拉起无头 Chrome（可用 `CHROME_PATH` 覆盖）、OS 分配端口、结束清理 profile |
| `scripts/vendor/` | 离线验收页用的 React 18.2 UMD（MIT，非插件依赖） |
| `samples/` | 10 mm 立方体样例（STEP + STL），验收与示例用 |

## 构建

```bash
npm ci            # 装 devDependencies（esbuild 已精确钉到 0.25.0）
npm run build     # 产出 lib/client.js，只调用本地 esbuild，不再走 npx / 联网
npm test          # 纯 Node 单测（extOf / 资源释放 / .gltf 策略 / 缩放 / 大小上限 / 上下文恢复 / 文案词表）
npm run verify    # Node 侧 STEP 验收
```

构建只依赖 `package-lock.json` 里的 esbuild，`npm ci` 之后可在离线 npm cache（如 `npm_config_cache=/tmp/npm-cache`）下复现；esbuild 失败时会打印它自己的 stderr。

`fs` / `path` 被标成 external：它们只出现在 emscripten 的 node-only 分支里，浏览器不会执行到；不标会让 esbuild 因为 Node 内建模块报错。

## 第三方组件与许可

本仓库自身以 MIT 发布（根目录 `LICENSE`）。随 `lib/client.js` 一起分发的第三方组件：

| 组件 | 版本 | 许可 | 分发方式 |
|---|---|---|---|
| [three.js](https://threejs.org) | 0.169.0 | MIT | 构建时内联进 `lib/client.js` |
| [occt-import-js](https://github.com/kovacsv/occt-import-js) | 0.0.23 | LGPL-2.1 | 构建时内联进 `lib/client.js`，其中含 OpenCASCADE（OCCT）编译出的 wasm |

原始许可文本随包分发，见 `licenses/license.occt.txt` 与 `licenses/license.occt-import-js.txt`（`package.json` 的 `files` 已包含，安装后会落在包里）。

内联的 OCCT wasm 由 `occt-import-js@0.0.23` 构建：执行 `npm i --no-save occt-import-js@0.0.23` 后 `npm run build` 即可重建。按 LGPL-2.1 的要求，你可以先用自己构建的等价 wasm 替换 `node_modules/occt-import-js/dist/occt-import-js.wasm`，再重新 `npm run build`，从而替换 `lib/client.js` 里内联的那份二进制。

## 没验证的部分

- **原生降级路径的可视效果**：在没有 better-sidebar 的干净 profile 里实测过注册（`documentPreviews` + `slots` 两路都成功、无告警）；但那个实例没有登录/会话，没有打开文件的入口，`content.kind === 'bytes'` 的取字节与画面仍未真跑过。
- **压缩过的 GLB/GLTF**：只验过未压缩的 `LeePerrySmith.glb`；带 DRACO / KTX2 压缩的模型会失败（没接解码器）。
- **深色主题适配**：画布背景写死 `#11161c`，不跟随宿主主题（宿主切浅色时面板仍是深色）。
- **单位**：底部读数一律写 `mm` —— 对 STEP/STL 成立；glTF 规范没有单位，那串数字只是模型空间尺寸。
- **解析错误文案**：工具栏/状态行已中英双语，但 STEP / STL / glTF 解析失败时的错误信息仍是中文诊断文本（只在失败时出现）。
- **其它 DSH 版本**：只在 0.2.1-rc.3 + better-sidebar 0.28.0 上验过。
