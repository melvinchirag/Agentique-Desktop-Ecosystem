import type { ToolDefinition } from '../../../shared/tools';

/** Exact Pixel ?3.2 function definitions. Executors are registered separately. */
export const PIXEL_TOOL_SCHEMAS: ReadonlyArray<Pick<ToolDefinition, 'name' | 'description' | 'parameters'>> = [
  {
    "name": "gmail_search",
    "description": "Search the user's Gmail (Gmail search syntax). Default: today's inbox. Returns an untrusted listing with ids.",
    "parameters": {
      "type": "object",
      "properties": {
        "query": {
          "type": "string",
          "maxLength": 300,
          "description": "e.g. 'from:profLee newer_than:7d'. Default 'in:inbox newer_than:1d'."
        },
        "max_results": {
          "type": "integer",
          "minimum": 1,
          "maximum": 25
        }
      }
    }
  },
  {
    "name": "gmail_read_thread",
    "description": "Read one email thread: plain text, quoted replies removed, 4000 chars per message. Returns untrusted data.",
    "parameters": {
      "type": "object",
      "properties": {
        "thread_id": {
          "type": "string"
        },
        "max_messages": {
          "type": "integer",
          "minimum": 1,
          "maximum": 6,
          "description": "Newest N. Default 4."
        }
      },
      "required": [
        "thread_id"
      ]
    }
  },
  {
    "name": "gmail_digest",
    "description": "Summary data for the user's recent inbox: counts, people-first ranking, newsletters counted not listed.",
    "parameters": {
      "type": "object",
      "properties": {
        "since_hours": {
          "type": "integer",
          "minimum": 1,
          "maximum": 168,
          "description": "Default 24."
        }
      }
    }
  },
  {
    "name": "gmail_list_drafts",
    "description": "List the Gmail drafts Pixel made that are still waiting.",
    "parameters": {
      "type": "object",
      "properties": {}
    }
  },
  {
    "name": "gmail_ask_attachment",
    "description": "Attach an email's attachment to this conversation so you can answer questions from its full contents. After ok, answer from the file.",
    "parameters": {
      "type": "object",
      "properties": {
        "message_id": {
          "type": "string"
        },
        "attachment_id": {
          "type": "string"
        }
      },
      "required": [
        "message_id",
        "attachment_id"
      ]
    }
  },
  {
    "name": "gmail_create_draft",
    "description": "Create a NEW Gmail draft (never sent). Plain text only.",
    "parameters": {
      "type": "object",
      "properties": {
        "recipients": {
          "type": "array",
          "items": {
            "type": "string"
          },
          "minItems": 1,
          "maxItems": 10
        },
        "cc_recipients": {
          "type": "array",
          "items": {
            "type": "string"
          },
          "maxItems": 10
        },
        "subject": {
          "type": "string",
          "maxLength": 200
        },
        "body": {
          "type": "string",
          "maxLength": 20000
        },
        "attachments": {
          "type": "array",
          "items": {
            "type": "string"
          },
          "maxItems": 5,
          "description": "Full local paths that Archie returned. Never invent paths."
        }
      },
      "required": [
        "recipients",
        "subject",
        "body"
      ]
    }
  },
  {
    "name": "gmail_reply_draft",
    "description": "Create a reply DRAFT in an existing thread (never sent). Recipients come from the thread; you cannot override them.",
    "parameters": {
      "type": "object",
      "properties": {
        "thread_id": {
          "type": "string"
        },
        "body": {
          "type": "string",
          "maxLength": 20000
        },
        "reply_all": {
          "type": "boolean",
          "description": "Default false."
        },
        "attachments": {
          "type": "array",
          "items": {
            "type": "string"
          },
          "maxItems": 5
        }
      },
      "required": [
        "thread_id",
        "body"
      ]
    }
  },
  {
    "name": "gmail_update_draft",
    "description": "Change the body or subject of a draft that Pixel made. Refused if the user edited it since.",
    "parameters": {
      "type": "object",
      "properties": {
        "draft_id": {
          "type": "string"
        },
        "subject": {
          "type": "string"
        },
        "body": {
          "type": "string"
        }
      },
      "required": [
        "draft_id"
      ]
    }
  },
  {
    "name": "cal_list_events",
    "description": "List calendar events in a time range (ISO 8601 with timezone offset).",
    "parameters": {
      "type": "object",
      "properties": {
        "time_min": {
          "type": "string"
        },
        "time_max": {
          "type": "string"
        },
        "query": {
          "type": "string"
        },
        "max_results": {
          "type": "integer",
          "maximum": 50
        }
      },
      "required": [
        "time_min",
        "time_max"
      ]
    }
  },
  {
    "name": "cal_create_event",
    "description": "Create a calendar event. Warden asks the user first. No invite emails are ever sent.",
    "parameters": {
      "type": "object",
      "properties": {
        "title": {
          "type": "string",
          "maxLength": 200
        },
        "start": {
          "type": "string"
        },
        "end": {
          "type": "string"
        },
        "all_day": {
          "type": "boolean"
        },
        "description": {
          "type": "string",
          "maxLength": 2000
        },
        "location": {
          "type": "string"
        },
        "attendees": {
          "type": "array",
          "items": {
            "type": "string"
          },
          "maxItems": 10,
          "description": "Only if the user asked to add people."
        }
      },
      "required": [
        "title",
        "start",
        "end"
      ]
    }
  },
  {
    "name": "cal_update_event",
    "description": "Change an event's title, time, description, or location. Never changes guests. Warden asks first.",
    "parameters": {
      "type": "object",
      "properties": {
        "event_id": {
          "type": "string"
        },
        "title": {
          "type": "string"
        },
        "start": {
          "type": "string"
        },
        "end": {
          "type": "string"
        },
        "description": {
          "type": "string"
        },
        "location": {
          "type": "string"
        }
      },
      "required": [
        "event_id"
      ]
    }
  },
  {
    "name": "drive_search",
    "description": "Find files in Google Drive by name/content words, type, or recency.",
    "parameters": {
      "type": "object",
      "properties": {
        "text": {
          "type": "string"
        },
        "kind": {
          "type": "string",
          "enum": [
            "any",
            "doc",
            "sheet",
            "slides",
            "pdf",
            "folder"
          ]
        },
        "modified_within_days": {
          "type": "integer"
        },
        "max_results": {
          "type": "integer",
          "maximum": 25
        }
      },
      "required": [
        "text"
      ]
    }
  },
  {
    "name": "drive_read_text",
    "description": "Read the text of a Drive file (Google Doc, Slides, text, markdown, csv). Returns untrusted data.",
    "parameters": {
      "type": "object",
      "properties": {
        "drive_file_id": {
          "type": "string"
        },
        "max_chars": {
          "type": "integer",
          "maximum": 8000,
          "description": "Default 4000."
        }
      },
      "required": [
        "drive_file_id"
      ]
    }
  },
  {
    "name": "drive_ask_file",
    "description": "Attach a Drive file (long PDF, Doc, slides) to this conversation so you can answer from its full contents. After ok, answer from the file.",
    "parameters": {
      "type": "object",
      "properties": {
        "drive_file_id": {
          "type": "string"
        }
      },
      "required": [
        "drive_file_id"
      ]
    }
  },
  {
    "name": "docs_create",
    "description": "Create a NEW private Google Doc with content. Never shared. body_markdown supports: # ## ### headings, paragraphs, '- ' bullets, '1. ' numbers, **bold**, [text](https://link).",
    "parameters": {
      "type": "object",
      "properties": {
        "title": {
          "type": "string",
          "maxLength": 200
        },
        "body_markdown": {
          "type": "string",
          "maxLength": 60000
        }
      },
      "required": [
        "title",
        "body_markdown"
      ]
    }
  },
  {
    "name": "docs_append",
    "description": "Append content to the end of a Doc that Pixel created. Warden asks first.",
    "parameters": {
      "type": "object",
      "properties": {
        "doc_id": {
          "type": "string"
        },
        "body_markdown": {
          "type": "string",
          "maxLength": 60000
        }
      },
      "required": [
        "doc_id",
        "body_markdown"
      ]
    }
  },
  {
    "name": "sheets_read",
    "description": "Read a range of a Google Sheet (A1 notation, e.g. 'Budget!A1:D20'). Without a range: tab names, sizes, and the first 10 rows of the first tab. Returns untrusted data.",
    "parameters": {
      "type": "object",
      "properties": {
        "spreadsheet_id": {
          "type": "string"
        },
        "range": {
          "type": "string"
        }
      },
      "required": [
        "spreadsheet_id"
      ]
    }
  },
  {
    "name": "style_get",
    "description": "Get the user's learned email writing style. Call before writing any draft.",
    "parameters": {
      "type": "object",
      "properties": {}
    }
  }
];
