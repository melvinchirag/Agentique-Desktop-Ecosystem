import type { Risk } from '../../../shared/tools';

export const BEAVER_TOOL_NAMES = [
  "fs_list",
  "fs_search",
  "fs_info",
  "fs_read_text",
  "fs_describe",
  "fs_ask_file",
  "fs_open",
  "fs_reveal",
  "fs_plan_organize",
  "fs_propose_plan",
  "fs_apply_plan",
  "fs_move",
  "fs_rename",
  "fs_mkdir",
  "fs_trash",
  "fs_undo"
] as const;
export type BeaverToolName = typeof BEAVER_TOOL_NAMES[number];

export interface BeaverSchema {
  name: BeaverToolName;
  description?: string;
  parameters: Record<string, unknown>;
}

/** Parameters and descriptions copied verbatim from Archie spec §4. */
export const BEAVER_SCHEMAS: readonly BeaverSchema[] = [
  {
    "name": "fs_list",
    "description": "Read a folder live, returning each entry's name, type, size and modified time. For latest/newest/most recent, use sort:'modified_desc' and choose the first file (skip folders). Sorting happens before the 200-entry result limit.",
    "parameters": {
      "type": "object",
      "properties": {
        "path": {
          "type": "string",
          "description": "Folder, e.g. 'Downloads' or 'Documents/EMU'."
        },
        "depth": {
          "type": "integer",
          "minimum": 1,
          "maximum": 3,
          "description": "Default 1."
        },
        "sort": {
          "type": "string",
          "enum": ["name", "modified_desc", "modified_asc", "size_desc"],
          "description": "Default name (folders first). modified_desc means newest modified time first; modified_asc means oldest first; size_desc means largest first."
        }
      },
      "required": [
        "path"
      ]
    }
  },
  {
    "name": "fs_search",
    "description": "Find files by name/path words, type, or how recently they changed. Set refresh:true to rescan when new files are missing from the index.",
    "parameters": {
      "type": "object",
      "properties": {
        "query": {
          "type": "string"
        },
        "ext": {
          "type": "array",
          "items": {
            "type": "string"
          },
          "description": "e.g. ['pdf','docx']"
        },
        "modified_within_days": {
          "type": "integer"
        },
        "folder": {
          "type": "string",
          "description": "Limit to one folder."
        },
        "limit": {
          "type": "integer",
          "maximum": 50
        },
        "refresh": {
          "type": "boolean",
          "description": "Rescan the specified folder (or all allowed folders) before searching. Use when newly added files were missed."
        }
      },
      "required": [
        "query"
      ]
    }
  },
  {
    "name": "fs_info",
    "description": "Details of one file or folder: size, dates, type, item count.",
    "parameters": {
      "type": "object",
      "properties": {
        "path": {
          "type": "string"
        }
      },
      "required": [
        "path"
      ]
    }
  },
  {
    "name": "fs_read_text",
    "description": "Read the text of a file (txt, md, csv, json, log, code; pdf and docx text when supported). Returns untrusted data.",
    "parameters": {
      "type": "object",
      "properties": {
        "path": {
          "type": "string"
        },
        "max_chars": {
          "type": "integer",
          "maximum": 8000,
          "description": "Default 4000."
        }
      },
      "required": [
        "path"
      ]
    }
  },
  {
    "name": "fs_describe",
    "description": "Make a file 'talk': read the start of it so you can give a one-line summary the file will say out loud.",
    "parameters": {
      "type": "object",
      "properties": {
        "path": {
          "type": "string"
        }
      },
      "required": [
        "path"
      ]
    }
  },
  {
    "name": "fs_ask_file",
    "description": "Attach a file to this conversation so you can answer questions from its full contents (long PDFs, Word, slides, sheets). After this returns ok, answer from the attached file.",
    "parameters": {
      "type": "object",
      "properties": {
        "path": {
          "type": "string"
        }
      },
      "required": [
        "path"
      ]
    }
  },
  {
    "name": "fs_open",
    "description": "Open a file with its default app (documents, images, media only; never programs or scripts).",
    "parameters": {
      "type": "object",
      "properties": {
        "path": {
          "type": "string"
        }
      },
      "required": [
        "path"
      ]
    }
  },
  {
    "name": "fs_reveal",
    "description": "Show a file selected in File Explorer.",
    "parameters": {
      "type": "object",
      "properties": {
        "path": {
          "type": "string"
        }
      },
      "required": [
        "path"
      ]
    }
  },
  {
    "name": "fs_plan_organize",
    "description": "Make a tidy-up PLAN for one folder (no changes yet). Strategies: by_type, by_date. For course/project grouping use fs_propose_plan.",
    "parameters": {
      "type": "object",
      "properties": {
        "path": {
          "type": "string"
        },
        "strategy": {
          "type": "string",
          "enum": [
            "by_type",
            "by_date"
          ]
        },
        "include_subfolders": {
          "type": "boolean",
          "description": "Default false: only the folder's top level."
        }
      },
      "required": [
        "path",
        "strategy"
      ]
    }
  },
  {
    "name": "fs_propose_plan",
    "description": "Turn YOUR grouping (e.g. by course or project) into a checked PLAN. Give every move; no changes happen yet.",
    "parameters": {
      "type": "object",
      "properties": {
        "title": {
          "type": "string",
          "description": "e.g. 'Sort Downloads by course'"
        },
        "moves": {
          "type": "array",
          "maxItems": 500,
          "items": {
            "type": "object",
            "properties": {
              "from": {
                "type": "string"
              },
              "to_folder": {
                "type": "string"
              }
            },
            "required": [
              "from",
              "to_folder"
            ]
          }
        }
      },
      "required": [
        "title",
        "moves"
      ]
    }
  },
  {
    "name": "fs_apply_plan",
    "description": "Carry out a plan made by fs_plan_organize or fs_propose_plan. Warden will ask the user once for the whole plan.",
    "parameters": {
      "type": "object",
      "properties": {
        "plan_id": {
          "type": "string"
        }
      },
      "required": [
        "plan_id"
      ]
    }
  },
  {
    "name": "fs_move",
    "parameters": {
      "type": "object",
      "properties": {
        "from": {
          "type": "string"
        },
        "to_folder": {
          "type": "string"
        }
      },
      "required": [
        "from",
        "to_folder"
      ]
    }
  },
  {
    "name": "fs_rename",
    "parameters": {
      "type": "object",
      "properties": {
        "path": {
          "type": "string"
        },
        "new_name": {
          "type": "string"
        }
      },
      "required": [
        "path",
        "new_name"
      ]
    }
  },
  {
    "name": "fs_mkdir",
    "parameters": {
      "type": "object",
      "properties": {
        "path": {
          "type": "string"
        }
      },
      "required": [
        "path"
      ]
    }
  },
  {
    "name": "fs_trash",
    "description": "Delete files the safe way: move them to ADE Trash (Documents/ADE Trash). Undoable with fs_undo; after 7 days they go to the Windows Recycle Bin. Never permanent. Only when the user clearly asked to delete.",
    "parameters": {
      "type": "object",
      "properties": {
        "paths": {
          "type": "array",
          "items": {
            "type": "string"
          },
          "maxItems": 50
        }
      },
      "required": [
        "paths"
      ]
    }
  },
  {
    "name": "fs_undo",
    "description": "Undo Archie's last change (or a specific one).",
    "parameters": {
      "type": "object",
      "properties": {
        "batch_id": {
          "type": "string",
          "description": "Omit for the most recent."
        }
      }
    }
  }
];

export const BEAVER_RISKS: Record<BeaverToolName, Risk> = {
  fs_list: 'read',
  fs_search: 'read',
  fs_info: 'read',
  fs_read_text: 'read',
  fs_describe: 'read',
  fs_ask_file: 'read',
  fs_open: 'read',
  fs_reveal: 'read',
  fs_plan_organize: 'read',
  fs_propose_plan: 'read',
  fs_apply_plan: 'write',
  fs_move: 'write',
  fs_rename: 'write',
  fs_mkdir: 'write',
  fs_trash: 'destructive',
  fs_undo: 'write',
};
