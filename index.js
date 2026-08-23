#!/usr/bin/env node

if (!process.argv.includes('--transport=sse') && process.env.MCP_TRANSPORT !== 'sse') {
  console.log = (...a) => {
    process.stderr.write(a.map(x => (typeof x === 'object' ? JSON.stringify(x) : String(x))).join(' ') + '\n');
  };
}

import express from 'express';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ErrorCode,
  McpError
} from '@modelcontextprotocol/sdk/types.js';

const args = process.argv.slice(2);
const isSseMode = args.includes('--transport=sse') || process.env.MCP_TRANSPORT === 'sse';

const CREDENTIALS_FILE = path.join(process.cwd(), '.milehost_agent.json');

export function loadCredentials() {
  try {
    if (fs.existsSync(CREDENTIALS_FILE)) {
      const raw = fs.readFileSync(CREDENTIALS_FILE, 'utf-8');
      return JSON.parse(raw);
    }
  } catch (e) {
    console.error('Error reading .milehost_agent.json:', e.message);
  }
  return null;
}

export function saveCredentials(data) {
  try {
    fs.writeFileSync(CREDENTIALS_FILE, JSON.stringify(data, null, 2), 'utf-8');
    return true;
  } catch (e) {
    console.error('Error writing .milehost_agent.json:', e.message);
    return false;
  }
}

export function getApiKey() {
  const creds = loadCredentials();
  if (creds && creds.agent_api_key) {
    return creds.agent_api_key;
  }
  if (process.env.MILEHOST_AGENT_API_KEY) {
    return process.env.MILEHOST_AGENT_API_KEY;
  }
  return null;
}

export function getApiUrl(customUrl) {
  if (customUrl && typeof customUrl === 'string' && customUrl.trim()) {
    return customUrl.trim().replace(/\/+$/, '');
  }
  const creds = loadCredentials();
  if (creds && creds.api_url) {
    return creds.api_url.replace(/\/+$/, '');
  }
  if (process.env.MILEHOST_API_URL) {
    return process.env.MILEHOST_API_URL.replace(/\/+$/, '');
  }
  return 'https://cab.mile.host';
}

const TOOLS = [
  {
    name: 'milehost_connect',
    description: 'Connects MCP agent to MileHost account via interactive browser authorization link and saves API key to .milehost_agent.json',
    inputSchema: {
      type: 'object',
      properties: {
        api_url: {
          type: 'string',
          description: 'Base URL of MileHost API (e.g. https://cab.mile.host)'
        },
        force: {
          type: 'boolean',
          description: 'Force re-authentication even if credentials already exist'
        }
      }
    }
  },
  {
    name: 'milehost_list_folders',
    description: 'Lists all available user containers / folders on MileHost',
    inputSchema: {
      type: 'object',
      properties: {}
    }
  },
  {
    name: 'milehost_list_servers',
    description: 'Lists all available user containers / folders on MileHost',
    inputSchema: {
      type: 'object',
      properties: {}
    }
  },
  {
    name: 'milehost_run_command',
    description: 'Executes a terminal / shell command directly inside user Docker container on MileHost (e.g. pip install -r requirements.txt, python bot.py, npm start)',
    inputSchema: {
      type: 'object',
      properties: {
        folder_id: {
          type: 'string',
          description: 'Target folder / container ID (optional if user has single container)'
        },
        command: {
          type: 'string',
          description: 'Terminal command string to execute in container'
        }
      },
      required: ['command']
    }
  },
  {
    name: 'milehost-run-command',
    description: 'Executes a terminal / shell command directly inside user Docker container on MileHost',
    inputSchema: {
      type: 'object',
      properties: {
        folder_id: {
          type: 'string',
          description: 'Target folder / container ID (optional if user has single container)'
        },
        command: {
          type: 'string',
          description: 'Terminal command string to execute in container'
        }
      },
      required: ['command']
    }
  },
  {
    name: 'milehost_reboot',
    description: 'Reboots / restarts the user server container on MileHost',
    inputSchema: {
      type: 'object',
      properties: {
        folder_id: {
          type: 'string',
          description: 'Target folder / container ID (optional if user has single container)'
        }
      }
    }
  },
  {
    name: 'milehost-reboot',
    description: 'Reboots / restarts the user server container on MileHost',
    inputSchema: {
      type: 'object',
      properties: {
        folder_id: {
          type: 'string',
          description: 'Target folder / container ID (optional if user has single container)'
        }
      }
    }
  },
  {
    name: 'clear-session',
    description: 'Kills previous active terminal sessions and background bot processes (Python/Node) to fix "Bot already running" or conflict errors before relaunching',
    inputSchema: {
      type: 'object',
      properties: {
        folder_id: {
          type: 'string',
          description: 'Target folder / container ID (optional if user has single container)'
        }
      }
    }
  },
  {
    name: 'clear_session',
    description: 'Kills previous active terminal sessions and background bot processes (Python/Node) to fix "Bot already running" or conflict errors before relaunching',
    inputSchema: {
      type: 'object',
      properties: {
        folder_id: {
          type: 'string',
          description: 'Target folder / container ID (optional if user has single container)'
        }
      }
    }
  },
  {
    name: 'create-file',
    description: 'Creates a new file with content in user container folder on MileHost',
    inputSchema: {
      type: 'object',
      properties: {
        folder_id: {
          type: 'string',
          description: 'Target folder / container ID (optional if user has single container)'
        },
        file_path: {
          type: 'string',
          description: 'Relative path of the file to create (e.g. bot.py or .env)'
        },
        content: {
          type: 'string',
          description: 'Content of the file'
        }
      },
      required: ['file_path', 'content']
    }
  },
  {
    name: 'create_file',
    description: 'Creates a new file with content in user container folder on MileHost',
    inputSchema: {
      type: 'object',
      properties: {
        folder_id: {
          type: 'string',
          description: 'Target folder / container ID (optional if user has single container)'
        },
        file_path: {
          type: 'string',
          description: 'Relative path of the file to create (e.g. bot.py or .env)'
        },
        content: {
          type: 'string',
          description: 'Content of the file'
        }
      },
      required: ['file_path', 'content']
    }
  },
  {
    name: 'write-to-file',
    description: 'Writes or updates file content in user container folder on MileHost',
    inputSchema: {
      type: 'object',
      properties: {
        folder_id: {
          type: 'string',
          description: 'Target folder / container ID (optional if user has single container)'
        },
        file_path: {
          type: 'string',
          description: 'Relative path of the file to write (e.g. config.py or index.js)'
        },
        content: {
          type: 'string',
          description: 'Content of the file'
        }
      },
      required: ['file_path', 'content']
    }
  },
  {
    name: 'write_to_file',
    description: 'Writes or updates file content in user container folder on MileHost',
    inputSchema: {
      type: 'object',
      properties: {
        folder_id: {
          type: 'string',
          description: 'Target folder / container ID (optional if user has single container)'
        },
        file_path: {
          type: 'string',
          description: 'Relative path of the file to write (e.g. config.py or index.js)'
        },
        content: {
          type: 'string',
          description: 'Content of the file'
        }
      },
      required: ['file_path', 'content']
    }
  },
  {
    name: 'milehost_deploy_file',
    description: 'Deploys a file to user container folder on MileHost',
    inputSchema: {
      type: 'object',
      properties: {
        folder_id: {
          type: 'string',
          description: 'Target folder / container ID (optional if user has single container)'
        },
        file_path: {
          type: 'string',
          description: 'Relative path of the file to deploy (e.g. index.html or src/app.js)'
        },
        content: {
          type: 'string',
          description: 'File content to write'
        }
      },
      required: ['file_path', 'content']
    }
  },
  {
    name: 'milehost_list_files',
    description: 'Lists files in user container folder on MileHost',
    inputSchema: {
      type: 'object',
      properties: {
        folder_id: {
          type: 'string',
          description: 'Target folder / container ID (optional if user has single container)'
        },
        path: {
          type: 'string',
          description: 'Subdirectory path (optional)'
        }
      }
    }
  },
  {
    name: 'milehost_read_file',
    description: 'Reads the content of a file inside user container folder on MileHost',
    inputSchema: {
      type: 'object',
      properties: {
        folder_id: {
          type: 'string',
          description: 'Target folder / container ID (optional if user has single container)'
        },
        file_path: {
          type: 'string',
          description: 'Relative path of the file to read (e.g. main.py or config.json)'
        }
      },
      required: ['file_path']
    }
  },
  {
    name: 'milehost_delete_file',
    description: 'Deletes a file or directory inside user container folder on MileHost',
    inputSchema: {
      type: 'object',
      properties: {
        folder_id: {
          type: 'string',
          description: 'Target folder / container ID (optional if user has single container)'
        },
        file_path: {
          type: 'string',
          description: 'Relative path of the file or directory to delete'
        }
      },
      required: ['file_path']
    }
  },
  {
    name: 'milehost_exec_command',
    description: 'Executes a shell / terminal command directly inside user Docker container on MileHost (e.g. pip install ..., python bot.py, ls -la)',
    inputSchema: {
      type: 'object',
      properties: {
        folder_id: {
          type: 'string',
          description: 'Target folder / container ID (optional if user has single container)'
        },
        command: {
          type: 'string',
          description: 'Terminal command string to execute in container'
        }
      },
      required: ['command']
    }
  },
  {
    name: 'milehost_restart_server',
    description: 'Restarts the user server container on MileHost',
    inputSchema: {
      type: 'object',
      properties: {
        folder_id: {
          type: 'string',
          description: 'Target folder / container ID (optional if user has single container)'
        }
      }
    }
  }
];

async function handleConnect(args = {}) {
  const force = !!args.force;
  const creds = loadCredentials();

  if (!force && creds && creds.agent_api_key && creds.api_url) {
    return {
      content: [
        {
          type: 'text',
          text: `Agent is already connected to ${creds.api_url}. Use force=true to reconnect.`
        }
      ]
    };
  }

  const targetApiUrl = getApiUrl(args.api_url);

  const linkRes = await fetch(`${targetApiUrl}/api/agent/link-request`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  });

  if (!linkRes.ok) {
    const errText = await linkRes.text();
    throw new Error(`Failed to initiate link request (${linkRes.status}): ${errText}`);
  }

  const linkData = await linkRes.json();
  if (!linkData.success || !linkData.token) {
    throw new Error(`Invalid link request response: ${JSON.stringify(linkData)}`);
  }

  const token = linkData.token;
  const connectUrl = linkData.connect_url || `https://cab.mile.host/connect-agent?token=${token}`;

  console.error('\n==================================================');
  console.error('AUTHORIZATION REQUIRED');
  console.error('Open this link in your browser to approve connection:');
  console.error(connectUrl);
  console.error('==================================================\n');

  const maxAttempts = 60;
  const pollIntervalMs = 2000;

  for (let i = 0; i < maxAttempts; i++) {
    await new Promise((r) => setTimeout(r, pollIntervalMs));

    try {
      const statusRes = await fetch(`${targetApiUrl}/api/agent/status?token=${encodeURIComponent(token)}`);
      if (!statusRes.ok) continue;

      const statusData = await statusRes.json();
      if (!statusData.success) continue;

      if (statusData.status === 'approved' && statusData.agent_api_key) {
        const savedCreds = {
          api_url: targetApiUrl,
          agent_api_key: statusData.agent_api_key,
          connected_at: new Date().toISOString()
        };
        saveCredentials(savedCreds);

        return {
          content: [
            {
              type: 'text',
              text: `Agent successfully connected to ${targetApiUrl}!\nAuthorization token approved.\nCredentials saved to .milehost_agent.json.`
            }
          ]
        };
      } else if (statusData.status === 'rejected') {
        throw new Error('Agent linking request was rejected by user.');
      } else if (statusData.status === 'expired') {
        throw new Error('Agent linking request expired.');
      }
    } catch (err) {
      if (err.message.includes('rejected') || err.message.includes('expired')) {
        throw err;
      }
    }
  }

  throw new Error('Polling timed out after 2 minutes waiting for user approval.');
}

async function handleDeployFile(args = {}) {
  const { folder_id, file_path, content } = args;
  if (!file_path || content === undefined) {
    throw new Error('Missing required arguments: file_path and content are required.');
  }

  const apiKey = getApiKey();
  const targetApiUrl = getApiUrl();

  if (!apiKey) {
    throw new Error('Agent not connected. Run milehost_connect tool first.');
  }

  const payload = {
    file_path,
    content
  };
  if (folder_id) {
    payload.folder_id = String(folder_id);
  }

  const res = await fetch(`${targetApiUrl}/api/agent/deploy`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify(payload)
  });

  const data = await res.json();
  if (!res.ok || !data.success) {
    throw new Error(`Deploy failed (${res.status}): ${data.error || data.message || JSON.stringify(data)}`);
  }

  return {
    content: [
      {
        type: 'text',
        text: `File successfully deployed!\nPath: ${data.path || file_path}\nBytes written: ${data.bytes ?? content.length}`
      }
    ]
  };
}

async function handleListFiles(args = {}) {
  const { folder_id, path: subPath } = args;

  const apiKey = getApiKey();
  const targetApiUrl = getApiUrl();

  if (!apiKey) {
    throw new Error('Agent not connected. Run milehost_connect tool first.');
  }

  const queryParams = new URLSearchParams();
  if (folder_id) {
    queryParams.set('folder_id', String(folder_id));
  }
  if (subPath) {
    queryParams.set('path', subPath);
  }

  const res = await fetch(`${targetApiUrl}/api/agent/files?${queryParams.toString()}`, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${apiKey}`
    }
  });

  const data = await res.json();
  if (!res.ok || !data.success) {
    throw new Error(`List files failed (${res.status}): ${data.error || data.message || JSON.stringify(data)}`);
  }

  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(data.files || data, null, 2)
      }
    ]
  };
}

async function handleRestartServer(args = {}) {
  const { folder_id } = args;

  const apiKey = getApiKey();
  const targetApiUrl = getApiUrl();

  if (!apiKey) {
    throw new Error('Agent not connected. Run milehost_connect tool first.');
  }

  const payload = {};
  if (folder_id) {
    payload.folder_id = String(folder_id);
  }

  const res = await fetch(`${targetApiUrl}/api/agent/restart`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify(payload)
  });

  const data = await res.json();
  if (!res.ok || !data.success) {
    throw new Error(`Restart server failed (${res.status}): ${data.error || data.message || JSON.stringify(data)}`);
  }

  return {
    content: [
      {
        type: 'text',
        text: `Server container restart status: ${data.message || 'Container restarted'}`
      }
    ]
  };
}

async function handleListFolders() {
  const apiKey = getApiKey();
  if (!apiKey) {
    throw new Error('Agent is not authenticated. Please run milehost_connect first.');
  }

  const targetApiUrl = getApiUrl();
  const res = await fetch(`${targetApiUrl}/api/agent/folders`, {
    headers: { 'Authorization': `Bearer ${apiKey}` }
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Failed to list folders (${res.status}): ${errText}`);
  }

  const data = await res.json();
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(data, null, 2)
      }
    ]
  };
}

async function handleReadFile(args = {}) {
  const apiKey = getApiKey();
  if (!apiKey) {
    throw new Error('Agent is not authenticated. Please run milehost_connect first.');
  }

  if (!args.file_path) {
    throw new Error('Missing required argument: file_path is required.');
  }

  const targetApiUrl = getApiUrl();
  const queryParams = new URLSearchParams();
  if (args.folder_id) queryParams.set('folder_id', args.folder_id);
  queryParams.set('file_path', args.file_path);

  const res = await fetch(`${targetApiUrl}/api/agent/read-file?${queryParams.toString()}`, {
    headers: { 'Authorization': `Bearer ${apiKey}` }
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Failed to read file (${res.status}): ${errText}`);
  }

  const data = await res.json();
  return {
    content: [
      {
        type: 'text',
        text: data.content ?? ''
      }
    ]
  };
}

async function handleDeleteFile(args = {}) {
  const apiKey = getApiKey();
  if (!apiKey) {
    throw new Error('Agent is not authenticated. Please run milehost_connect first.');
  }

  if (!args.file_path) {
    throw new Error('Missing required argument: file_path is required.');
  }

  const targetApiUrl = getApiUrl();
  const payload = {
    file_path: args.file_path
  };
  if (args.folder_id) {
    payload.folder_id = args.folder_id;
  }

  const res = await fetch(`${targetApiUrl}/api/agent/delete-file`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify(payload)
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Failed to delete file (${res.status}): ${errText}`);
  }

  const data = await res.json();
  return {
    content: [
      {
        type: 'text',
        text: data.message || 'File deleted successfully'
      }
    ]
  };
}

async function handleExecCommand(args = {}) {
  const apiKey = getApiKey();
  if (!apiKey) {
    throw new Error('Agent is not authenticated. Please run milehost_connect first.');
  }

  if (!args.command) {
    throw new Error('Missing required argument: command is required.');
  }

  const targetApiUrl = getApiUrl();
  const payload = {
    command: args.command
  };
  if (args.folder_id) {
    payload.folder_id = args.folder_id;
  }

  const res = await fetch(`${targetApiUrl}/api/agent/exec`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify(payload)
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Failed to execute command (${res.status}): ${errText}`);
  }

  const data = await res.json();
  const output = [];
  if (data.stdout) output.push(`STDOUT:\n${data.stdout}`);
  if (data.stderr) output.push(`STDERR:\n${data.stderr}`);
  output.push(`Exit Code: ${data.exitCode}`);

  return {
    content: [
      {
        type: 'text',
        text: output.join('\n\n')
      }
    ]
  };
}

async function handleClearSession(args = {}) {
  const apiKey = getApiKey();
  if (!apiKey) {
    throw new Error('Agent is not authenticated. Please run milehost_connect first.');
  }

  const targetApiUrl = getApiUrl();
  const payload = {};
  if (args.folder_id) {
    payload.folder_id = args.folder_id;
  }

  const res = await fetch(`${targetApiUrl}/api/agent/clear-session`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify(payload)
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Failed to clear session (${res.status}): ${errText}`);
  }

  const data = await res.json();
  return {
    content: [
      {
        type: 'text',
        text: data.message || 'Previous terminal sessions and background bot processes stopped successfully. Ready for new launch.'
      }
    ]
  };
}

export function createServer() {
  const server = new Server(
    {
      name: 'milehost-agent-mcp',
      version: '1.0.0'
    },
    {
      capabilities: {
        tools: {}
      }
    }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return { tools: TOOLS };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: toolArgs } = request.params;
    try {
      if (name === 'milehost_connect') {
        return await handleConnect(toolArgs || {});
      } else if (name === 'milehost_list_folders' || name === 'milehost_list_servers') {
        return await handleListFolders();
      } else if (
        name === 'create-file' ||
        name === 'create_file' ||
        name === 'write-to-file' ||
        name === 'write_to_file' ||
        name === 'milehost_deploy_file' ||
        name === 'milehost_create_file' ||
        name === 'milehost_write_to_file'
      ) {
        return await handleDeployFile(toolArgs || {});
      } else if (name === 'milehost_read_file' || name === 'milehost_get_file') {
        return await handleReadFile(toolArgs || {});
      } else if (name === 'milehost_delete_file') {
        return await handleDeleteFile(toolArgs || {});
      } else if (name === 'milehost_run_command' || name === 'milehost-run-command' || name === 'milehost_exec_command') {
        return await handleExecCommand(toolArgs || {});
      } else if (name === 'clear-session' || name === 'clear_session' || name === 'milehost_clear_session' || name === 'milehost-clear-session') {
        return await handleClearSession(toolArgs || {});
      } else if (name === 'milehost_list_files') {
        return await handleListFiles(toolArgs || {});
      } else if (name === 'milehost_reboot' || name === 'milehost-reboot' || name === 'milehost_restart_server') {
        return await handleRestartServer(toolArgs || {});
      } else {
        throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
      }
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Error: ${error.message || String(error)}`
          }
        ],
        isError: true
      };
    }
  });

  return server;
}

export async function main() {
  if (isSseMode) {
    const app = express();
    const PORT = process.env.PORT || 3001;

    app.use(cors());

    const transports = new Map();

    app.get('/sse', async (req, res) => {
      console.error('New SSE connection requested');
      const transport = new SSEServerTransport('/message', res);
      transports.set(transport.sessionId, transport);
      transport.onclose = () => {
        transports.delete(transport.sessionId);
      };
      const server = createServer();
      await server.connect(transport);
    });

    app.post('/message', async (req, res) => {
      const sessionId = req.query.sessionId;
      const transport = transports.get(sessionId);
      if (!transport) {
        res.status(400).send('Session not found');
        return;
      }
      await transport.handlePostMessage(req, res);
    });

    app.listen(PORT, () => {
      console.error(`MileHost MCP Server listening on SSE transport port ${PORT}`);
      console.error(`SSE endpoint: http://localhost:${PORT}/sse`);
      console.error(`Message endpoint: http://localhost:${PORT}/message`);
    });
  } else {
    process.stdin.resume();
    const server = createServer();
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error('MileHost MCP Server running on stdio transport');
  }
}

main().catch((err) => {
  console.error('Fatal error running MCP Server:', err);
  process.exit(1);
});
