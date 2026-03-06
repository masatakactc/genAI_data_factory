"use client";

import Editor from "@monaco-editor/react";

interface JsonSchemaEditorProps {
  value: string;
  onChange: (value: string) => void;
}

const DEFAULT_SCHEMA = JSON.stringify(
  {
    type: "OBJECT",
    properties: {
      user_query: {
        type: "STRING",
        description: "ユーザーからの質問文",
      },
      agent_response: {
        type: "STRING",
        description: "AIの回答",
      },
    },
    required: ["user_query", "agent_response"],
  },
  null,
  2
);

export { DEFAULT_SCHEMA };

export default function JsonSchemaEditor({
  value,
  onChange,
}: JsonSchemaEditorProps) {
  return (
    <div className="border rounded-md overflow-hidden">
      <Editor
        height="300px"
        defaultLanguage="json"
        value={value}
        onChange={(v) => onChange(v ?? "")}
        theme="vs-light"
        options={{
          minimap: { enabled: false },
          fontSize: 13,
          lineNumbers: "on",
          scrollBeyondLastLine: false,
          wordWrap: "on",
          tabSize: 2,
          formatOnPaste: true,
        }}
      />
    </div>
  );
}
