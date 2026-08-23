# MileHost MCP Server

Official Model Context Protocol (MCP) Server for MileHost. This server provides AI agents (such as Claude Code, Google Antigravity, Cursor, Windsurf, Claude Desktop, and custom MCP clients) with autonomous capabilities to interact with MileHost cloud hosting, manage containerized bot environments, execute remote terminal commands, manage files, and control server instances.

---

## Capabilities

- Interactive browser-based authentication flow with zero password leakage.
- Container management (list containers, reboot instances, stop stale processes).
- Remote terminal execution inside isolated Docker containers (Python, Node.js, bash).
- Container file system operations (list directory contents, read files, write and deploy files, delete files).
- Dual transport support: Standard I/O (stdio) for local agents and Server-Sent Events (SSE) for remote/networked agents.
- Clean JSON-RPC communication with strict stdio log routing to stderr.

---

## Installation and Quick Start

### Running via NPX

You can run the server directly without manual cloning:

```bash
npx -y milehost-mcp
```

Or for SSE transport mode:

```bash
npx -y milehost-mcp --transport=sse
```

### Local Clone and Installation

```bash
git clone https://github.com/Mile-Host/mcp-server.git
cd mcp-server
npm install
npm start
```

---

## Agent and Client Configuration

### 1. Claude Code

Run the following command in your terminal to register the server globally:

```bash
# Using npx (recommended)
claude mcp add milehost -- npx -y milehost-mcp

# Or using local script path
claude mcp add milehost -- node /absolute/path/to/mcp-package/index.js
```

### 2. Google Antigravity

Add the server definition to your Antigravity MCP configuration file (`mcp_config.json`):

```json
{
  "mcpServers": {
    "milehost": {
      "command": "npx",
      "args": ["-y", "milehost-mcp"],
      "env": {
        "MILEHOST_API_URL": "https://cab.mile.host"
      }
    }
  }
}
```

### 3. Cursor and Windsurf

Add the following block to your MCP configuration in settings (`~/.cursor/mcp.json` or `~/.codeium/windsurf/mcp_config.json`):

```json
{
  "mcpServers": {
    "milehost": {
      "command": "node",
      "args": ["/absolute/path/to/mcp-package/index.js"],
      "env": {
        "MILEHOST_API_URL": "https://cab.mile.host"
      }
    }
  }
}
```

### 4. Claude Desktop

Add the server entry to `claude_desktop_config.json`:

- On macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
- On Windows: `%APPDATA%/Claude/claude_desktop_config.json`

```json
{
  "mcpServers": {
    "milehost": {
      "command": "npx",
      "args": ["-y", "milehost-mcp"]
    }
  }
}
```

---

## Transport Modes

### Stdio Transport (Default)

Used for local CLI tools and IDE extensions. Standard input and standard output handle MCP JSON-RPC protocol frames. All application logs and diagnostic output are redirected to stderr.

```bash
node index.js
```

### SSE Transport (Server-Sent Events)

Used for distributed architectures, web services, or remote agent setups.

```bash
# Via CLI flag
node index.js --transport=sse

# Via environment variables
MCP_TRANSPORT=sse PORT=3001 node index.js
```

Default SSE endpoints:
- SSE stream: `GET http://localhost:3001/sse`
- Message handler: `POST http://localhost:3001/message?sessionId=<sessionId>`

---

## Authentication Flow

The MileHost MCP server implements an interactive, token-based pairing workflow:

1. The agent calls the `milehost_connect` tool.
2. The server requests a pairing token from the MileHost Cabinet API (`https://cab.mile.host/api/agent/link-request`).
3. An authorization URL is printed to the agent console and returned in the tool response:
   ```
   https://cab.mile.host/connect-agent?token=link_xxxxxxxx
   ```
4. The user opens the link in their web browser and confirms access in the MileHost Cabinet.
5. The MCP server polls the status endpoint until approval is granted.
6. Upon approval, an agent API key is issued and saved locally to `.milehost_agent.json`.
7. Subsequent tool calls authenticate automatically using the stored credentials.

Alternatively, you can provide an API key directly via the `MILEHOST_AGENT_API_KEY` environment variable.

---

## Tool Reference

### Authentication

#### `milehost_connect`
Connects the MCP server to the user's MileHost account via interactive browser authorization link.

Parameters:
- `api_url` (string, optional): Target MileHost API base URL (default: `https://cab.mile.host`).
- `force` (boolean, optional): Re-authenticate even if credentials already exist.

---

### Container Discovery

#### `milehost_list_folders` / `milehost_list_servers`
Retrieves a list of all active user containers and folders on MileHost.

Parameters:
- None.

---

### Command Execution and Process Management

#### `milehost_run_command` / `milehost-run-command` / `milehost_exec_command`
Executes terminal and shell commands inside the specified Docker container on MileHost.

Parameters:
- `command` (string, required): Shell command string to execute (e.g. `pip install -r requirements.txt`, `npm start`, `python bot.py`).
- `folder_id` (string, optional): Container or folder ID. Optional if the account has only one container.

#### `clear-session` / `clear_session`
Terminates previous active terminal sessions and background bot processes (Python, Node.js) to resolve conflict errors before starting a new run.

Parameters:
- `folder_id` (string, optional): Container or folder ID.

#### `milehost_reboot` / `milehost-reboot` / `milehost_restart_server`
Reboots the container instance and restarts background services.

Parameters:
- `folder_id` (string, optional): Container or folder ID.

---

### File Operations

#### `create-file` / `create_file` / `write-to-file` / `write_to_file` / `milehost_deploy_file`
Creates or overwrites a file inside the user's container.

Parameters:
- `file_path` (string, required): Relative path of the file (e.g. `bot.py`, `config.json`, `.env`).
- `content` (string, required): Full content of the file.
- `folder_id` (string, optional): Target container or folder ID.

#### `milehost_list_files`
Lists files and subdirectories inside the container.

Parameters:
- `folder_id` (string, optional): Container or folder ID.
- `path` (string, optional): Subdirectory path to inspect.

#### `milehost_read_file`
Reads the content of an existing file inside the container.

Parameters:
- `file_path` (string, required): Relative path of the file to read.
- `folder_id` (string, optional): Target container or folder ID.

#### `milehost_delete_file`
Deletes a file or directory from the container.

Parameters:
- `file_path` (string, required): Relative path of the file to remove.
- `folder_id` (string, optional): Target container or folder ID.

---

## Environment Variables

| Variable | Description | Default |
|---|---|---|
| `MILEHOST_API_URL` | Base API URL of MileHost | `https://cab.mile.host` |
| `MILEHOST_AGENT_API_KEY` | Agent API key for automated authentication | Loaded from `.milehost_agent.json` |
| `MCP_TRANSPORT` | Transport mode (`stdio` or `sse`) | `stdio` |
| `PORT` | HTTP port for SSE transport | `3001` |

---

## File Structure

```
mcp-package/
├── .gitignore
├── LICENSE
├── README.md
├── index.js
└── package.json
```

---

## License

This project is licensed under the MIT License. See [LICENSE](LICENSE) for details.
