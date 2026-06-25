# Vector Forge Lab MCP 接入教程

本教程说明如何让 Claude Desktop、Cursor、Codex 或其他支持 MCP 的 AI 软件调用 Vector Forge Lab 的本地向量库。

## 1. 先验证项目可运行

在项目目录执行：

```powershell
cd C:\Users\jackwolf-power\Documents\Codex\2026-06-21\r\work\vector-forge-lab
npm install
npm run smoke
```

`npm run smoke` 会真实执行：

- 启动临时 API。
- 创建临时 LanceDB 集合。
- 写入一段文本。
- 执行向量检索。
- 启动 MCP stdio server。
- 通过 MCP 调用 `vf_search`。
- 通过 MCP 读取 7 个只读 resources，并检查返回内容不泄露 API key。
- 删除测试文档。

看到 `"ok": true` 即说明 MCP 和本地向量库链路可用。

## 2. MCP Server 命令

开发模式：

```powershell
npm run mcp
```

推荐给 MCP 客户端配置的实际命令：

```powershell
node C:\Users\jackwolf-power\Documents\Codex\2026-06-21\r\work\vector-forge-lab\node_modules\tsx\dist\cli.mjs C:\Users\jackwolf-power\Documents\Codex\2026-06-21\r\work\vector-forge-lab\server\mcp.ts
```

如果已经运行 API，可指定：

```powershell
$env:VECTOR_FORGE_API_URL="http://127.0.0.1:5183"
```

如果没运行 API，MCP 默认会自动启动一个临时本地 API。可用以下变量关闭：

```powershell
$env:VECTOR_FORGE_MCP_AUTOSTART="false"
```

## 3. Claude Desktop 配置示例

把下面内容加入 Claude Desktop 的 MCP 配置文件：

```json
{
  "mcpServers": {
    "vector-forge-lab": {
      "command": "node",
      "args": [
        "C:\\Users\\jackwolf-power\\Documents\\Codex\\2026-06-21\\r\\work\\vector-forge-lab\\node_modules\\tsx\\dist\\cli.mjs",
        "C:\\Users\\jackwolf-power\\Documents\\Codex\\2026-06-21\\r\\work\\vector-forge-lab\\server\\mcp.ts"
      ],
      "env": {
        "VECTOR_FORGE_ROOT_DIR": "C:\\Users\\jackwolf-power\\Documents\\Codex\\2026-06-21\\r\\work\\vector-forge-lab",
        "VECTOR_FORGE_DATA_DIR": "C:\\Users\\jackwolf-power\\Documents\\Codex\\2026-06-21\\r\\work\\vector-forge-lab\\data"
      }
    }
  }
}
```

## 4. AnythingLLM MCP 配置示例

AnythingLLM 支持把外部 MCP server 接入 agent。可在 AnythingLLM 的 MCP server 配置中添加 stdio server：

```json
{
  "vector-forge-lab": {
    "command": "node",
    "args": [
      "C:\\Users\\jackwolf-power\\Documents\\Codex\\2026-06-21\\r\\work\\vector-forge-lab\\node_modules\\tsx\\dist\\cli.mjs",
      "C:\\Users\\jackwolf-power\\Documents\\Codex\\2026-06-21\\r\\work\\vector-forge-lab\\server\\mcp.ts"
    ],
    "env": {
      "VECTOR_FORGE_ROOT_DIR": "C:\\Users\\jackwolf-power\\Documents\\Codex\\2026-06-21\\r\\work\\vector-forge-lab",
      "VECTOR_FORGE_DATA_DIR": "C:\\Users\\jackwolf-power\\Documents\\Codex\\2026-06-21\\r\\work\\vector-forge-lab\\data"
    }
  }
}
```

具体文件位置取决于 AnythingLLM Desktop 当前版本和配置目录；在 AnythingLLM 的 MCP 设置页添加同等命令即可。

## 5. 暴露的 MCP Resources

- `vectorforge://health`
  - API 健康状态、版本、LanceDB 路径、表列表、配置摘要。
- `vectorforge://collections`
  - 所有本地向量集合。
- `vectorforge://collections/{slug}/documents`
  - 指定集合下的文档列表。
- `vectorforge://embedding-provider/status`
  - 当前 embedding provider 配置和各知识库索引兼容状态；只显示 key 是否配置，不返回密钥。
- `vectorforge://jobs/recent`
  - 最近上传、解析、OCR、embedding、同步和重处理任务。
- `vectorforge://anythingllm/sync-status`
  - 本地记录的 AnythingLLM 同步状态、workspace slug、location 计数和清理状态；不主动访问 AnythingLLM。
- `vectorforge://documents/quality`
  - OCR/解析质量报告概览，包括低置信度、失败、警告、解析器覆盖和是否需要人工复核。

桌面 UI 的 `MCP` 卡片也列出这些 URI，并提供复制按钮；`{slug}` 会按当前知识库替换，方便直接贴到 AI 客户端或调试脚本里。

## 6. 暴露的 MCP Tools

| Tool | 默认可用 | 作用 |
|---|---:|---|
| `vf_stats` | 是 | 返回 API、集合、LanceDB 和 embedding 配置状态。 |
| `vf_list_collections` | 是 | 列出本地向量集合。 |
| `vf_search` | 是 | 用自然语言 query 检索指定集合。 |
| `vf_get_document` | 是 | 获取文档元数据和 chunks。 |
| `vf_upsert_text` | 否 | 写入文本到集合，需要 `mcp.allowWrites=true`。 |
| `vf_delete_document` | 否 | 删除文档和 chunks，需要 `mcp.allowWrites=true`。 |

## 7. 推荐 AI 调用方式

让 AI 先调用：

```text
vf_list_collections
```

然后选择目标集合调用：

```text
vf_search(collection="你的集合 slug", query="你的问题", topK=8)
```

回答时要求 AI 引用返回里的：

- `title`
- `sourcePath`
- `chunkIndex`
- `score`
- `preview/text`

## 8. 写入权限

默认 MCP 写入关闭，避免外部 AI 客户端误写或误删数据。

需要开启时：

1. 打开 Vector Forge Lab UI。
2. 在“模型 / MCP / AnythingLLM”区域勾选 `MCP 允许写入`。
3. 点击 `保存配置`。

开启后 MCP 客户端才能调用：

- `vf_upsert_text`
- `vf_delete_document`

## 9. 安全边界

- 默认使用 stdio MCP，不开放公网 HTTP。
- API 只绑定 `127.0.0.1`。
- CORS 只允许本机 loopback 来源。
- `/api/health` 会脱敏 API key，MCP resource 和 `vf_stats` 不暴露密钥。
- `/api/config` 是给本地 UI 使用的完整配置接口，会返回 API key；不要把 API 端口反代或暴露到局域网/公网。
- 不要把 AnythingLLM API key 提交到仓库。
- 不要让不可信 AI 客户端开启写入工具。
- 删除集合和删除文档都是真删除本地向量记录；删除集合需要 UI 输入 slug 确认。
- `mcp.allowWrites` 只有保存为布尔值 `true` 才会开启，字符串 `"false"` 不会误开写入权限。
