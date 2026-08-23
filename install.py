import os
import sys
import json
import time
import shutil
import subprocess
from pathlib import Path

REQUIRED_PACKAGES = ['rich', 'colorama']

def ensure_dependencies():
    missing = []
    for pkg in REQUIRED_PACKAGES:
        try:
            __import__(pkg)
        except ImportError:
            missing.append(pkg)
    if missing:
        print('Не бойтесь, сейчас просто установим нужные библиотеки...')
        try:
            subprocess.check_call([sys.executable, '-m', 'pip', 'install', *missing, '-q'])
        except Exception as e:
            print(f'Предупреждение: не удалось автоматически установить библиотеки ({e}). Продолжаем...')

ensure_dependencies()

from rich.console import Console
from rich.panel import Panel
from rich.text import Text
from rich.progress import Progress, SpinnerColumn, TextColumn, BarColumn, TimeElapsedColumn
from rich.prompt import Prompt
from rich.style import Style
from rich.align import Align
from rich import box

console = Console()

LOGO_LINES = [
    "          ▄▄▄▄              ▄▄▄▄▄         ",
    "       ▄████▀   █        ▄█████▀  ▄▄      ",
    "      ▄████▀   ███▄     ▄█████   ▄██      ",
    "     ▄████▀   ▀████▄   ▄████▀   ▄████     ",
    "    ▄████▀     ▀████  █████▀     █████    ",
    "   ▄████    █▄  ▀██  █████▀   ▄  ▀████▄   ",
    "  ▄████    ███▄  ▀ ▄█████▀   ██▄  ▀████▄  ",
    " ▄████   ▄█████▄  ▄█████    ████▄  ▀████▄ ",
    " ▀▀▀    ▄█████▀   ▀▀▀▀      █████▄   ▀▀▀▀ ",
    "       ▀▀▀▀▀▀                 ▀▀▀▀▀       ",
]

def get_antigravity_mcp_dir():
    home = Path.home()
    return home / '.gemini' / 'antigravity' / 'mcp' / 'milehost'

def get_tools_definitions():
    return [
        {
            'name': 'milehost_connect',
            'description': 'Connects MCP agent to MileHost account via interactive browser authorization link',
            'parameters': {
                'type': 'object',
                'properties': {
                    'api_url': {'type': 'string', 'description': 'Base URL of MileHost API'},
                    'force': {'type': 'boolean', 'description': 'Force re-authentication'}
                }
            }
        },
        {
            'name': 'milehost_run_command',
            'description': 'Executes a terminal / shell command directly inside user Docker container on MileHost',
            'parameters': {
                'type': 'object',
                'properties': {
                    'command': {'type': 'string', 'description': 'Command string to execute in container'},
                    'folder_id': {'type': 'string', 'description': 'Target server/folder ID (optional)'}
                },
                'required': ['command']
            }
        },
        {
            'name': 'milehost_reboot',
            'description': 'Reboots / restarts the user server container and all running processes on MileHost',
            'parameters': {
                'type': 'object',
                'properties': {
                    'folder_id': {'type': 'string', 'description': 'Target server/folder ID (optional)'}
                }
            }
        },
        {
            'name': 'clear_session',
            'description': 'Kills previous active terminal sessions and background bot processes to fix Bot already running error',
            'parameters': {
                'type': 'object',
                'properties': {
                    'folder_id': {'type': 'string', 'description': 'Target server/folder ID (optional)'}
                }
            }
        },
        {
            'name': 'create_file',
            'description': 'Creates a new file with content in user container folder on MileHost',
            'parameters': {
                'type': 'object',
                'properties': {
                    'folder_id': {'type': 'string', 'description': 'Target server/folder ID (optional)'},
                    'file_path': {'type': 'string', 'description': 'Relative path of the file to create'},
                    'content': {'type': 'string', 'description': 'Content of the file'}
                },
                'required': ['file_path', 'content']
            }
        },
        {
            'name': 'write_to_file',
            'description': 'Writes or updates file content in user container folder on MileHost',
            'parameters': {
                'type': 'object',
                'properties': {
                    'folder_id': {'type': 'string', 'description': 'Target server/folder ID (optional)'},
                    'file_path': {'type': 'string', 'description': 'Relative path of the file to write'},
                    'content': {'type': 'string', 'description': 'Content of the file'}
                },
                'required': ['file_path', 'content']
            }
        },
        {
            'name': 'milehost_list_files',
            'description': 'Lists files in user container folder on MileHost',
            'parameters': {
                'type': 'object',
                'properties': {
                    'folder_id': {'type': 'string', 'description': 'Target server/folder ID (optional)'},
                    'path': {'type': 'string', 'description': 'Subdirectory path (optional)'}
                }
            }
        },
        {
            'name': 'milehost_read_file',
            'description': 'Reads the content of a file inside user container folder on MileHost',
            'parameters': {
                'type': 'object',
                'properties': {
                    'folder_id': {'type': 'string', 'description': 'Target server/folder ID (optional)'},
                    'file_path': {'type': 'string', 'description': 'Relative path of the file to read'}
                },
                'required': ['file_path']
            }
        },
        {
            'name': 'milehost_list_servers',
            'description': 'Lists all available user containers / folders on MileHost',
            'parameters': {
                'type': 'object',
                'properties': {}
            }
        }
    ]

def render_banner(animated=True):
    console.clear()
    logo_text = Text()
    for line in LOGO_LINES:
        logo_text.append(line + "\n", style="bold #b2e11a")

    if animated:
        for line in LOGO_LINES:
            console.print(Align.center(Text(line, style="bold #b2e11a")))
            time.sleep(0.02)
    else:
        console.print(Align.center(logo_text))
    console.print()

def install_mcp():
    target_dir = get_antigravity_mcp_dir()
    source_dir = Path(__file__).resolve().parent

    console.print(f"Целевая директория: [bold #b2e11a]{target_dir}[/]")
    console.print()

    with Progress(
        SpinnerColumn(spinner_name="dots", style="bold #b2e11a"),
        TextColumn("[progress.description]{task.description}"),
        BarColumn(complete_style="#b2e11a", finished_style="bold #b2e11a"),
        TimeElapsedColumn(),
        console=console
    ) as progress:
        task1 = progress.add_task("Создание структуры директорий...", total=4)
        target_dir.mkdir(parents=True, exist_ok=True)
        time.sleep(0.15)
        progress.advance(task1)

        progress.update(task1, description="Копирование исполняемых модулей сервера...")
        files_to_copy = ['index.js', 'package.json', 'README.md', 'LICENSE']
        for file_name in files_to_copy:
            src = source_dir / file_name
            if src.exists():
                shutil.copy2(src, target_dir / file_name)
        time.sleep(0.15)
        progress.advance(task1)

        progress.update(task1, description="Генерация 9 JSON-манифестов инструментов...")
        tools = get_tools_definitions()
        for tool in tools:
            schema_path = target_dir / f"{tool['name']}.json"
            with open(schema_path, 'w', encoding='utf-8') as f:
                json.dump(tool, f, indent=2, ensure_ascii=False)
        time.sleep(0.15)
        progress.advance(task1)

        progress.update(task1, description="Установка зависимостей Node.js...")
        try:
            subprocess.run(['npm', 'install', '--omit=dev'], cwd=str(target_dir), check=True, shell=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        except Exception:
            pass
        progress.advance(task1)

    success_text = Text()
    success_text.append("Установка успешно завершена.\n", style="bold #ffffff")
    success_text.append("MCP-сервер зарегистрирован в Antigravity:\n", style="#888891")
    success_text.append(f"{target_dir}\n\n", style="bold #b2e11a")
    success_text.append("Инструменты готовы к вызову: ", style="#888891")
    success_text.append("milehost_connect, milehost_run_command, clear_session, write_to_file, milehost_reboot", style="bold #ffffff")

    panel = Panel(
        success_text,
        title="[bold #b2e11a]STATUS: SUCCESS[/]",
        border_style="#b2e11a",
        box=box.ROUNDED,
        padding=(1, 2)
    )
    console.print()
    console.print(panel)

def uninstall_mcp():
    target_dir = get_antigravity_mcp_dir()
    if not target_dir.exists():
        console.print(f"[bold red]Директория {target_dir} не найдена. MCP-сервер не установлен.[/]")
        return

    with Progress(
        SpinnerColumn(spinner_name="dots", style="bold red"),
        TextColumn("[progress.description]{task.description}"),
        console=console
    ) as progress:
        task = progress.add_task("Удаление MCP-сервера и схем...", total=None)
        time.sleep(0.3)
        try:
            shutil.rmtree(target_dir)
        except Exception as e:
            console.print(f"[bold red]Ошибка при удалении: {e}[/]")
            return

    remove_text = Text()
    remove_text.append("MCP-сервер MileHost успешно удален из Antigravity.\n", style="bold #ffffff")
    remove_text.append(f"Удаленная директория: {target_dir}", style="dim #888891")

    panel = Panel(
        remove_text,
        title="[bold red]STATUS: UNINSTALLED[/]",
        border_style="red",
        box=box.ROUNDED,
        padding=(1, 2)
    )
    console.print()
    console.print(panel)

def main():
    render_banner(animated=True)

    menu_text = Text()
    menu_text.append("[ 1 ]  ", style="bold #b2e11a")
    menu_text.append("Установить / Обновить MCP Server в Antigravity\n", style="bold #ffffff")
    menu_text.append("[ 2 ]  ", style="bold red")
    menu_text.append("Удалить MCP Server из Antigravity\n", style="bold #ffffff")
    menu_text.append("[ 3 ]  ", style="dim #888891")
    menu_text.append("Выход", style="dim #888891")

    menu_panel = Panel(
        menu_text,
        title="[bold #ffffff]Действие[/]",
        border_style="#26262b",
        box=box.ROUNDED,
        padding=(1, 2)
    )
    console.print(menu_panel)
    console.print()

    choice = Prompt.ask("[bold #b2e11a]Выберите пункт[/]", choices=["1", "2", "3"], default="1")
    console.print()

    if choice == "1":
        install_mcp()
    elif choice == "2":
        uninstall_mcp()
    elif choice == "3":
        console.print("[dim #888891]Работа завершена.[/]")

if __name__ == '__main__':
    main()
