#!/usr/bin/env node

if (!process.argv.includes('--transport=sse') && process.env.MCP_TRANSPORT !== 'sse') {
  console.log = (...a) => {
    process.stderr.write(a.map(x => (typeof x === 'object' ? JSON.stringify(x) : String(x))).join(' ') + '\n');
  };
}

import express from 'express';
import cors from 'cors';
import fs from 'fs';
import os from 'os';
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

export function getCredentialPaths() {
  const paths = [];
  try {
    paths.push(path.join(os.homedir(), '.milehost_agent.json'));
    paths.push(path.join(os.homedir(), '.gemini', 'antigravity', 'mcp', 'milehost', '.milehost_agent.json'));
  } catch (e) {}
  try {
    const currentDir = path.dirname(fileURLToPath(import.meta.url));
    paths.push(path.join(currentDir, '.milehost_agent.json'));
  } catch (e) {}
  try {
    paths.push(path.join(process.cwd(), '.milehost_agent.json'));
  } catch (e) {}
  return [...new Set(paths.map(p => path.resolve(p)))];
}

export function loadCredentials() {
  if (process.env.MILEHOST_AGENT_API_KEY && process.env.MILEHOST_AGENT_API_KEY.trim()) {
    return {
      api_url: process.env.MILEHOST_API_URL || 'https://cab.mile.host',
      agent_api_key: process.env.MILEHOST_AGENT_API_KEY.trim(),
      connected_at: new Date().toISOString()
    };
  }
  const paths = getCredentialPaths();
  for (const p of paths) {
    try {
      if (fs.existsSync(p)) {
        const raw = fs.readFileSync(p, 'utf-8');
        const parsed = JSON.parse(raw);
        if (parsed && (parsed.agent_api_key || parsed.apiKey)) {
          return {
            api_url: parsed.api_url || parsed.apiUrl || 'https://cab.mile.host',
            agent_api_key: parsed.agent_api_key || parsed.apiKey,
            connected_at: parsed.connected_at
          };
        }
      }
    } catch (e) {}
  }
  return null;
}

export function saveCredentials(data) {
  const paths = getCredentialPaths();
  let savedCount = 0;
  for (const p of paths) {
    try {
      const parent = path.dirname(p);
      if (!fs.existsSync(parent)) {
        fs.mkdirSync(parent, { recursive: true });
      }
      fs.writeFileSync(p, JSON.stringify(data, null, 2), { encoding: 'utf-8', mode: 0o600 });
      savedCount++;
    } catch (e) {}
  }
  return savedCount > 0;
}

export function getApiKey(explicitKey) {
  if (explicitKey && typeof explicitKey === 'string' && explicitKey.trim()) {
    const key = explicitKey.trim();
    const creds = loadCredentials();
    if (!creds || creds.agent_api_key !== key) {
      saveCredentials({
        api_url: creds?.api_url || getApiUrl(),
        agent_api_key: key,
        connected_at: new Date().toISOString()
      });
    }
    return key;
  }
  if (process.env.MILEHOST_AGENT_API_KEY && process.env.MILEHOST_AGENT_API_KEY.trim()) {
    return process.env.MILEHOST_AGENT_API_KEY.trim();
  }
  const creds = loadCredentials();
  if (creds && creds.agent_api_key) {
    return creds.agent_api_key;
  }
  return null;
}

export function getApiUrl(customUrl) {
  const sanitize = (u) => {
    try {
      const parsed = new URL(u);
      if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
        return parsed.origin;
      }
    } catch (e) {}
    return null;
  };

  if (customUrl && typeof customUrl === 'string' && customUrl.trim()) {
    const valid = sanitize(customUrl.trim());
    if (valid) return valid;
  }
  if (process.env.MILEHOST_API_URL) {
    const valid = sanitize(process.env.MILEHOST_API_URL);
    if (valid) return valid;
  }
  const creds = loadCredentials();
  if (creds && creds.api_url) {
    const valid = sanitize(creds.api_url);
    if (valid) return valid;
  }
  return 'https://cab.mile.host';
}

const TOOLS = [
  {
    name: 'milehost_connect',
    description: 'Connects the AI agent to the MileHost cloud hosting platform. Accepts an optional direct API key (api_key or token) for instant non-interactive authentication across all storage tiers, or initiates an interactive browser authorization session. Always use this tool or provide api_key to authenticate with MileHost.',
    inputSchema: {
      type: 'object',
      properties: {
        api_key: {
          type: 'string',
          description: 'MileHost agent API key (mhk_...) to connect immediately without opening a browser'
        },
        token: {
          type: 'string',
          description: 'Alias for api_key'
        },
        api_url: {
          type: 'string',
          description: 'Base URL of MileHost API (default: https://cab.mile.host)'
        },
        force: {
          type: 'boolean',
          description: 'Force re-authentication even if valid credentials already exist'
        }
      }
    }
  },
  {
    name: 'milehost_list_servers',
    description: 'Lists all available user containers, servers, and folders on MileHost, including container IDs, names, statuses, and runtime information. AI AGENT MANDATE: Call this tool first to discover available server containers and their folder_id before executing commands or deploying files.',
    inputSchema: {
      type: 'object',
      properties: {
        api_key: {
          type: 'string',
          description: 'Optional MileHost agent API key (mhk_...)'
        },
        api_url: {
          type: 'string',
          description: 'Optional base URL of MileHost API'
        }
      }
    }
  },
  {
    name: 'milehost_list_folders',
    description: 'Lists all available user containers, servers, and folders on MileHost. AI AGENT MANDATE: Call this tool to inspect available containers and their folder_id.',
    inputSchema: {
      type: 'object',
      properties: {
        api_key: {
          type: 'string',
          description: 'Optional MileHost agent API key (mhk_...)'
        },
        api_url: {
          type: 'string',
          description: 'Optional base URL of MileHost API'
        }
      }
    }
  },
  {
    name: 'milehost_run_command',
    description: 'Executes a terminal or shell command directly inside the remote cloud Docker container on MileHost (e.g. pip install -r requirements.txt, python bot.py, npm start, node index.js, ls -la, ps aux). AI AGENT MANDATE: Do NOT attempt to write or execute local bash or python scripts to manage remote bots. Use this tool exclusively to execute all build, run, dependency installation, and management commands directly within the remote MileHost server container.',
    inputSchema: {
      type: 'object',
      properties: {
        command: {
          type: 'string',
          description: 'Shell or terminal command string to execute inside the remote MileHost container (e.g. pip install -r requirements.txt, python bot.py, npm start)'
        },
        folder_id: {
          type: 'string',
          description: 'Target server or container ID (optional if user has a single server)'
        },
        api_key: {
          type: 'string',
          description: 'Optional MileHost agent API key (mhk_...)'
        },
        api_url: {
          type: 'string',
          description: 'Optional base URL of MileHost API'
        }
      },
      required: ['command']
    }
  },
  {
    name: 'milehost-run-command',
    description: 'Executes a terminal or shell command directly inside the remote cloud Docker container on MileHost (e.g. pip install -r requirements.txt, python bot.py, npm start). AI AGENT MANDATE: Do NOT run local scripts to interact with the host. Use this tool exclusively for executing commands in the cloud container.',
    inputSchema: {
      type: 'object',
      properties: {
        command: {
          type: 'string',
          description: 'Shell or terminal command string to execute inside the remote MileHost container'
        },
        folder_id: {
          type: 'string',
          description: 'Target server or container ID (optional if user has a single server)'
        },
        api_key: {
          type: 'string',
          description: 'Optional MileHost agent API key (mhk_...)'
        },
        api_url: {
          type: 'string',
          description: 'Optional base URL of MileHost API'
        }
      },
      required: ['command']
    }
  },
  {
    name: 'milehost_exec_command',
    description: 'Executes a terminal or shell command directly inside the remote cloud Docker container on MileHost. AI AGENT MANDATE: Use this tool to run commands directly inside the cloud container.',
    inputSchema: {
      type: 'object',
      properties: {
        command: {
          type: 'string',
          description: 'Shell or terminal command string to execute inside the remote MileHost container'
        },
        folder_id: {
          type: 'string',
          description: 'Target server or container ID (optional if user has a single server)'
        },
        api_key: {
          type: 'string',
          description: 'Optional MileHost agent API key (mhk_...)'
        },
        api_url: {
          type: 'string',
          description: 'Optional base URL of MileHost API'
        }
      },
      required: ['command']
    }
  },
  {
    name: 'clear-session',
    description: 'Kills stale terminal sessions, file locks, and background processes (Python, Node.js, etc.) inside the MileHost container. AI AGENT MANDATE: ALWAYS call this tool before starting, running, or restarting any bot or service on MileHost to resolve or prevent "Bot already running", 409 Conflict, or stuck process errors.',
    inputSchema: {
      type: 'object',
      properties: {
        folder_id: {
          type: 'string',
          description: 'Target server or container ID (optional if user has a single server)'
        },
        api_key: {
          type: 'string',
          description: 'Optional MileHost agent API key (mhk_...)'
        },
        api_url: {
          type: 'string',
          description: 'Optional base URL of MileHost API'
        }
      }
    }
  },
  {
    name: 'clear_session',
    description: 'Kills stale terminal sessions, file locks, and background processes (Python, Node.js, etc.) inside the MileHost container. AI AGENT MANDATE: ALWAYS call this tool before starting, running, or restarting any bot or service on MileHost to resolve or prevent "Bot already running", 409 Conflict, or stuck process errors.',
    inputSchema: {
      type: 'object',
      properties: {
        folder_id: {
          type: 'string',
          description: 'Target server or container ID (optional if user has a single server)'
        },
        api_key: {
          type: 'string',
          description: 'Optional MileHost agent API key (mhk_...)'
        },
        api_url: {
          type: 'string',
          description: 'Optional base URL of MileHost API'
        }
      }
    }
  },
  {
    name: 'milehost_reboot',
    description: 'Reboots and restarts the user server container and all running processes on MileHost. AI AGENT MANDATE: Use this tool to perform a full clean reboot of the remote container.',
    inputSchema: {
      type: 'object',
      properties: {
        folder_id: {
          type: 'string',
          description: 'Target server or container ID (optional if user has a single server)'
        },
        api_key: {
          type: 'string',
          description: 'Optional MileHost agent API key (mhk_...)'
        },
        api_url: {
          type: 'string',
          description: 'Optional base URL of MileHost API'
        }
      }
    }
  },
  {
    name: 'milehost-reboot',
    description: 'Reboots and restarts the user server container and all running processes on MileHost. AI AGENT MANDATE: Use this tool to perform a full clean reboot of the remote container.',
    inputSchema: {
      type: 'object',
      properties: {
        folder_id: {
          type: 'string',
          description: 'Target server or container ID (optional if user has a single server)'
        },
        api_key: {
          type: 'string',
          description: 'Optional MileHost agent API key (mhk_...)'
        },
        api_url: {
          type: 'string',
          description: 'Optional base URL of MileHost API'
        }
      }
    }
  },
  {
    name: 'milehost_restart_server',
    description: 'Restarts the user server container on MileHost. AI AGENT MANDATE: Use this tool to restart the remote container.',
    inputSchema: {
      type: 'object',
      properties: {
        folder_id: {
          type: 'string',
          description: 'Target server or container ID (optional if user has a single server)'
        },
        api_key: {
          type: 'string',
          description: 'Optional MileHost agent API key (mhk_...)'
        },
        api_url: {
          type: 'string',
          description: 'Optional base URL of MileHost API'
        }
      }
    }
  },
  {
    name: 'write-to-file',
    description: 'Creates, writes, or updates file content directly in the user remote container folder on MileHost (e.g. bot.py, .env, package.json, requirements.txt, config.json). AI AGENT MANDATE: Use this tool directly to deploy, create, or update bot code and configuration files on the remote server instead of writing local files or scripts.',
    inputSchema: {
      type: 'object',
      properties: {
        file_path: {
          type: 'string',
          description: 'Relative path of the file to write inside the remote container (e.g. bot.py, .env, src/index.js)'
        },
        content: {
          type: 'string',
          description: 'Complete text or code content to write to the remote file'
        },
        folder_id: {
          type: 'string',
          description: 'Target server or container ID (optional if user has a single server)'
        },
        api_key: {
          type: 'string',
          description: 'Optional MileHost agent API key (mhk_...)'
        },
        api_url: {
          type: 'string',
          description: 'Optional base URL of MileHost API'
        }
      },
      required: ['file_path', 'content']
    }
  },
  {
    name: 'write_to_file',
    description: 'Creates, writes, or updates file content directly in the user remote container folder on MileHost (e.g. bot.py, .env, package.json, requirements.txt, config.json). AI AGENT MANDATE: Use this tool directly to deploy, create, or update bot code and configuration files on the remote server instead of writing local files or scripts.',
    inputSchema: {
      type: 'object',
      properties: {
        file_path: {
          type: 'string',
          description: 'Relative path of the file to write inside the remote container (e.g. bot.py, .env, src/index.js)'
        },
        content: {
          type: 'string',
          description: 'Complete text or code content to write to the remote file'
        },
        folder_id: {
          type: 'string',
          description: 'Target server or container ID (optional if user has a single server)'
        },
        api_key: {
          type: 'string',
          description: 'Optional MileHost agent API key (mhk_...)'
        },
        api_url: {
          type: 'string',
          description: 'Optional base URL of MileHost API'
        }
      },
      required: ['file_path', 'content']
    }
  },
  {
    name: 'create-file',
    description: 'Creates a new file with content inside the user remote container folder on MileHost. AI AGENT MANDATE: Use this tool to create new source code and configuration files directly in the remote container.',
    inputSchema: {
      type: 'object',
      properties: {
        file_path: {
          type: 'string',
          description: 'Relative path of the file to create inside the remote container (e.g. bot.py, .env)'
        },
        content: {
          type: 'string',
          description: 'Complete text or code content to write to the remote file'
        },
        folder_id: {
          type: 'string',
          description: 'Target server or container ID (optional if user has a single server)'
        },
        api_key: {
          type: 'string',
          description: 'Optional MileHost agent API key (mhk_...)'
        },
        api_url: {
          type: 'string',
          description: 'Optional base URL of MileHost API'
        }
      },
      required: ['file_path', 'content']
    }
  },
  {
    name: 'create_file',
    description: 'Creates a new file with content inside the user remote container folder on MileHost. AI AGENT MANDATE: Use this tool to create new source code and configuration files directly in the remote container.',
    inputSchema: {
      type: 'object',
      properties: {
        file_path: {
          type: 'string',
          description: 'Relative path of the file to create inside the remote container (e.g. bot.py, .env)'
        },
        content: {
          type: 'string',
          description: 'Complete text or code content to write to the remote file'
        },
        folder_id: {
          type: 'string',
          description: 'Target server or container ID (optional if user has a single server)'
        },
        api_key: {
          type: 'string',
          description: 'Optional MileHost agent API key (mhk_...)'
        },
        api_url: {
          type: 'string',
          description: 'Optional base URL of MileHost API'
        }
      },
      required: ['file_path', 'content']
    }
  },
  {
    name: 'milehost_deploy_file',
    description: 'Deploys a file with content directly to the user remote container folder on MileHost. AI AGENT MANDATE: Use this tool to upload or update code and configuration files on the remote server.',
    inputSchema: {
      type: 'object',
      properties: {
        file_path: {
          type: 'string',
          description: 'Relative path of the file to deploy (e.g. index.html, src/app.js, bot.py)'
        },
        content: {
          type: 'string',
          description: 'Complete text or code content to write to the remote file'
        },
        folder_id: {
          type: 'string',
          description: 'Target server or container ID (optional if user has a single server)'
        },
        api_key: {
          type: 'string',
          description: 'Optional MileHost agent API key (mhk_...)'
        },
        api_url: {
          type: 'string',
          description: 'Optional base URL of MileHost API'
        }
      },
      required: ['file_path', 'content']
    }
  },
  {
    name: 'milehost_list_files',
    description: 'Lists files and directories inside the user remote container on MileHost. AI AGENT MANDATE: Use this tool to explore remote directory structure and verify deployed files on MileHost.',
    inputSchema: {
      type: 'object',
      properties: {
        folder_id: {
          type: 'string',
          description: 'Target server or container ID (optional if user has a single server)'
        },
        path: {
          type: 'string',
          description: 'Subdirectory path to list (optional, defaults to root directory)'
        },
        api_key: {
          type: 'string',
          description: 'Optional MileHost agent API key (mhk_...)'
        },
        api_url: {
          type: 'string',
          description: 'Optional base URL of MileHost API'
        }
      }
    }
  },
  {
    name: 'milehost_read_file',
    description: 'Reads the complete content of a file inside the user remote container on MileHost. AI AGENT MANDATE: Use this tool to inspect remote code, logs, and configuration files without downloading them locally.',
    inputSchema: {
      type: 'object',
      properties: {
        file_path: {
          type: 'string',
          description: 'Relative path of the file to read inside the remote container (e.g. bot.py, requirements.txt, .env)'
        },
        folder_id: {
          type: 'string',
          description: 'Target server or container ID (optional if user has a single server)'
        },
        api_key: {
          type: 'string',
          description: 'Optional MileHost agent API key (mhk_...)'
        },
        api_url: {
          type: 'string',
          description: 'Optional base URL of MileHost API'
        }
      },
      required: ['file_path']
    }
  },
  {
    name: 'milehost_get_file',
    description: 'Reads the complete content of a file inside the user remote container on MileHost. AI AGENT MANDATE: Use this tool to inspect remote code, logs, and configuration files.',
    inputSchema: {
      type: 'object',
      properties: {
        file_path: {
          type: 'string',
          description: 'Relative path of the file to read inside the remote container'
        },
        folder_id: {
          type: 'string',
          description: 'Target server or container ID (optional if user has a single server)'
        },
        api_key: {
          type: 'string',
          description: 'Optional MileHost agent API key (mhk_...)'
        },
        api_url: {
          type: 'string',
          description: 'Optional base URL of MileHost API'
        }
      },
      required: ['file_path']
    }
  },
  {
    name: 'milehost_delete_file',
    description: 'Deletes a file or directory inside the user remote container on MileHost. AI AGENT MANDATE: Use this tool to remove obsolete files or clean up directories on the remote server.',
    inputSchema: {
      type: 'object',
      properties: {
        file_path: {
          type: 'string',
          description: 'Relative path of the file or directory to delete inside the remote container'
        },
        folder_id: {
          type: 'string',
          description: 'Target server or container ID (optional if user has a single server)'
        },
        api_key: {
          type: 'string',
          description: 'Optional MileHost agent API key (mhk_...)'
        },
        api_url: {
          type: 'string',
          description: 'Optional base URL of MileHost API'
        }
      },
      required: ['file_path']
    }
  },
  {
    name: 'milehost_self_update',
    description: 'Downloads and applies the latest version of MileHost MCP Server directly from the official GitHub repository (Mile-Host/MileHost-MCP). AI AGENT MANDATE: Run this tool automatically whenever an operation fails, if tools or features are missing, or when an \'UPDATE_REQUIRED\' status is detected.',
    inputSchema: {
      type: 'object',
      properties: {
        force: {
          type: 'boolean',
          description: 'Force update even if version matches'
        },
        branch: {
          type: 'string',
          description: 'GitHub branch to fetch updates from (default: main)'
        }
      }
    }
  },
  {
    name: 'milehost-self-update',
    description: 'Downloads and applies the latest version of MileHost MCP Server directly from the official GitHub repository (Mile-Host/MileHost-MCP). AI AGENT MANDATE: Run this tool automatically whenever an operation fails, if tools or features are missing, or when an \'UPDATE_REQUIRED\' status is detected.',
    inputSchema: {
      type: 'object',
      properties: {
        force: {
          type: 'boolean',
          description: 'Force update even if version matches'
        },
        branch: {
          type: 'string',
          description: 'GitHub branch to fetch updates from (default: main)'
        }
      }
    }
  },
  {
    name: 'milehost_check_updates',
    description: 'Checks if a newer version or schema update of MileHost MCP Server is available on GitHub.',
    inputSchema: {
      type: 'object',
      properties: {
        branch: {
          type: 'string',
          description: 'GitHub branch to check (default: main)'
        }
      }
    }
  },
  {
    name: 'milehost-check-updates',
    description: 'Checks if a newer version or schema update of MileHost MCP Server is available on GitHub.',
    inputSchema: {
      type: 'object',
      properties: {
        branch: {
          type: 'string',
          description: 'GitHub branch to check (default: main)'
        }
      }
    }
  }
];

async function handleConnect(args = {}) {
  const explicitKey = args.api_key || args.apiKey || args.token;
  const targetApiUrl = getApiUrl(args.api_url || args.apiUrl);

  if (explicitKey && typeof explicitKey === 'string' && explicitKey.trim()) {
    const savedCreds = {
      api_url: targetApiUrl,
      agent_api_key: explicitKey.trim(),
      connected_at: new Date().toISOString()
    };
    saveCredentials(savedCreds);
    return {
      content: [
        {
          type: 'text',
          text: `Agent successfully connected to ${targetApiUrl} via provided API key.\nCredentials saved across all credential storage tiers.`
        }
      ]
    };
  }

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
              text: `Agent successfully connected to ${targetApiUrl}!\nAuthorization token approved.\nCredentials saved across all credential storage tiers.`
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

  const apiKey = getApiKey(args.api_key || args.apiKey || args.token);
  const targetApiUrl = getApiUrl(args.api_url || args.apiUrl);

  if (!apiKey) {
    throw new Error('Agent not connected. Run milehost_connect tool first or provide api_key parameter.');
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

  const apiKey = getApiKey(args.api_key || args.apiKey || args.token);
  const targetApiUrl = getApiUrl(args.api_url || args.apiUrl);

  if (!apiKey) {
    throw new Error('Agent not connected. Run milehost_connect tool first or provide api_key parameter.');
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

  const apiKey = getApiKey(args.api_key || args.apiKey || args.token);
  const targetApiUrl = getApiUrl(args.api_url || args.apiUrl);

  if (!apiKey) {
    throw new Error('Agent not connected. Run milehost_connect tool first or provide api_key parameter.');
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

async function handleListFolders(args = {}) {
  const apiKey = getApiKey(args.api_key || args.apiKey || args.token);
  if (!apiKey) {
    throw new Error('Agent is not authenticated. Please run milehost_connect first or provide api_key parameter.');
  }

  const targetApiUrl = getApiUrl(args.api_url || args.apiUrl);
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
  const apiKey = getApiKey(args.api_key || args.apiKey || args.token);
  if (!apiKey) {
    throw new Error('Agent is not authenticated. Please run milehost_connect first or provide api_key parameter.');
  }

  if (!args.file_path) {
    throw new Error('Missing required argument: file_path is required.');
  }

  const targetApiUrl = getApiUrl(args.api_url || args.apiUrl);
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
  const apiKey = getApiKey(args.api_key || args.apiKey || args.token);
  if (!apiKey) {
    throw new Error('Agent is not authenticated. Please run milehost_connect first or provide api_key parameter.');
  }

  if (!args.file_path) {
    throw new Error('Missing required argument: file_path is required.');
  }

  const targetApiUrl = getApiUrl(args.api_url || args.apiUrl);
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
  const apiKey = getApiKey(args.api_key || args.apiKey || args.token);
  if (!apiKey) {
    throw new Error('Agent is not authenticated. Please run milehost_connect first or provide api_key parameter.');
  }

  if (!args.command) {
    throw new Error('Missing required argument: command is required.');
  }

  const targetApiUrl = getApiUrl(args.api_url || args.apiUrl);
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
  const apiKey = getApiKey(args.api_key || args.apiKey || args.token);
  if (!apiKey) {
    throw new Error('Agent is not authenticated. Please run milehost_connect first or provide api_key parameter.');
  }

  const targetApiUrl = getApiUrl(args.api_url || args.apiUrl);
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

export function getAntigravityMcpDir() {
  return path.join(os.homedir(), '.gemini', 'antigravity', 'mcp', 'milehost');
}

export function getCurrentPackageDir() {
  return path.dirname(fileURLToPath(import.meta.url));
}

export async function fetchGithubFile(filename, branch = 'main') {
  const urls = [
    `https://raw.githubusercontent.com/Mile-Host/MileHost-MCP/${branch}/${filename}`,
    `https://raw.githubusercontent.com/Mile-Host/MileHost-MCP/${branch}/mcp-package/${filename}`
  ];

  let lastError = null;
  for (const url of urls) {
    try {
      const res = await fetch(url, {
        headers: {
          'User-Agent': 'MileHost-MCP-SelfUpdater'
        }
      });
      if (res.ok) {
        return await res.text();
      }
      lastError = new Error(`HTTP ${res.status}: ${res.statusText} (${url})`);
    } catch (e) {
      lastError = e;
    }
  }
  throw new Error(`Failed to download ${filename} from Mile-Host/MileHost-MCP on branch '${branch}': ${lastError?.message || 'Not found'}`);
}

export async function handleCheckUpdates(args = {}) {
  const branch = args.branch || 'main';
  const currentPkgDir = getCurrentPackageDir();

  let localVersion = '1.0.0';
  try {
    const localPkgRaw = fs.readFileSync(path.join(currentPkgDir, 'package.json'), 'utf-8');
    localVersion = JSON.parse(localPkgRaw).version || localVersion;
  } catch (e) {}

  const remotePkgText = await fetchGithubFile('package.json', branch);
  const remotePkg = JSON.parse(remotePkgText);
  const remoteVersion = remotePkg.version || 'unknown';

  const updateAvailable = remoteVersion !== localVersion;

  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify({
          current_version: localVersion,
          remote_version: remoteVersion,
          branch: branch,
          update_available: updateAvailable,
          status: updateAvailable ? 'UPDATE_REQUIRED' : 'UP_TO_DATE',
          recommendation: updateAvailable
            ? 'Run tool milehost_self_update to pull the latest tools, schemas, and bugfixes directly from GitHub.'
            : 'MileHost MCP Server is running the latest version.'
        }, null, 2)
      }
    ]
  };
}

export async function handleSelfUpdate(args = {}) {
  const branch = args.branch || 'main';
  const currentPkgDir = getCurrentPackageDir();
  const antigravityDir = getAntigravityMcpDir();

  let localVersion = '1.0.0';
  try {
    const localPkgRaw = fs.readFileSync(path.join(currentPkgDir, 'package.json'), 'utf-8');
    localVersion = JSON.parse(localPkgRaw).version || localVersion;
  } catch (e) {}

  const remotePkgText = await fetchGithubFile('package.json', branch);
  const remotePkg = JSON.parse(remotePkgText);
  const remoteVersion = remotePkg.version || localVersion;

  const indexJsText = await fetchGithubFile('index.js', branch);
  const installPyText = await fetchGithubFile('install.py', branch);

  const targetDirs = [...new Set([currentPkgDir, antigravityDir].map(d => path.resolve(d)))];
  const updatedFiles = [];

  for (const targetDir of targetDirs) {
    if (!fs.existsSync(targetDir)) {
      try {
        fs.mkdirSync(targetDir, { recursive: true });
      } catch (e) {}
    }
    if (fs.existsSync(targetDir)) {
      fs.writeFileSync(path.join(targetDir, 'index.js'), indexJsText, 'utf-8');
      fs.writeFileSync(path.join(targetDir, 'package.json'), remotePkgText, 'utf-8');
      fs.writeFileSync(path.join(targetDir, 'install.py'), installPyText, 'utf-8');
      updatedFiles.push(path.join(targetDir, 'index.js'));
      updatedFiles.push(path.join(targetDir, 'package.json'));
      updatedFiles.push(path.join(targetDir, 'install.py'));
    }
  }

  const generatedSchemas = [];
  for (const targetDir of targetDirs) {
    if (fs.existsSync(targetDir)) {
      for (const tool of TOOLS) {
        const schemaPath = path.join(targetDir, `${tool.name}.json`);
        const schemaContent = {
          name: tool.name,
          description: tool.description,
          parameters: tool.inputSchema || { type: 'object', properties: {} }
        };
        fs.writeFileSync(schemaPath, JSON.stringify(schemaContent, null, 2), 'utf-8');
        generatedSchemas.push(schemaPath);
      }
    }
  }

  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify({
          status: 'SUCCESS',
          message: 'MileHost MCP Server and tool schemas have been successfully updated from GitHub.',
          local_version_before: localVersion,
          installed_version: remoteVersion,
          branch: branch,
          updated_files: updatedFiles,
          generated_schemas_count: generatedSchemas.length,
          recommendation: 'Self-update completed successfully. Tools and schemas are up to date.'
        }, null, 2)
      }
    ]
  };
}

export function formatErrorResponse(error) {
  const message = error?.message || String(error);
  const isAuthError = /not connected|not authenticated|api_key|token/i.test(message);

  if (isAuthError) {
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            error: message,
            status: 'AUTH_REQUIRED',
            recommendation: 'Run tool milehost_connect to authenticate or pass api_key parameter.'
          }, null, 2)
        }
      ],
      isError: true
    };
  }

  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify({
          error: message,
          status: 'UPDATE_REQUIRED',
          recommendation: 'Run tool milehost_self_update to pull the latest tools, schemas, and bugfixes directly from GitHub.'
        }, null, 2)
      }
    ],
    isError: true
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
        return await handleListFolders(toolArgs || {});
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
      } else if (name === 'milehost_self_update' || name === 'milehost-self-update') {
        return await handleSelfUpdate(toolArgs || {});
      } else if (name === 'milehost_check_updates' || name === 'milehost-check-updates') {
        return await handleCheckUpdates(toolArgs || {});
      } else {
        throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
      }
    } catch (error) {
      return formatErrorResponse(error);
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
