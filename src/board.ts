import * as yaml from "js-yaml";

import rules, { Rule } from "./rules";
import {
  getConfigNote,
  searchNotes,
  resolveNotebookPath,
  NoteData,
} from "./noteData";
import type { Action } from "./actions"

export interface Config {
  filters: {
    [ruleName: string]: string | string[];
    rootNotebookPath: string;
  };
  columns: {
    [ruleName: string]: string | string[] | boolean | undefined;
    name: string;
    backlog?: boolean;
  }[];
}

export interface DataQuery {
  method: "post" | "delete" | "put";
  path: string[];
  body?: object;
}

interface Column {
  name: string;
  rules: Rule[];
  backlog: boolean;
}

interface SortedColumn {
  name: string;
  notes: NoteData[];
}

export type BoardState = SortedColumn[];

export interface Board {
  boardName: string;
  updateNotes(): void;
  hasNote(noteId: string): boolean;
  processAction(action: Action): void;
  getState(): BoardState;
}

const parseConfigNote = async (
  boardNoteBody: string
): Promise<Config | null> => {
  const configRegex = /^```kanban(.*)```/ms;
  const match = boardNoteBody.match(configRegex);
  if (!match || match.length < 2) return null;

  const configStr = match[1];
  const configObj = yaml.load(configStr) as Config;

  // TODO: return error messages on invalid configs
  return configObj;
};

const createQueryFromRules = (rules: Rule[], negate: boolean) =>
  rules
    .map(({ searchQueries }) =>
      searchQueries.map((s: string) => (negate ? `-${s}` : s)).join(" ")
    )
    .join("	");

export default async function (boardNoteId: string): Promise<Board | null> {
  const {
    title: boardName,
    body: configBody,
    parent_id: boardNotebookId,
  } = await getConfigNote(boardNoteId);
  const configObj = await parseConfigNote(configBody);
  if (!configObj) return null;

  const { rootNotebookPath = "." } = configObj.filters;
  const rootNotebookId =
    rootNotebookPath === "."
      ? boardNotebookId
      : await resolveNotebookPath(rootNotebookPath);
  if (!rootNotebookId) return null;

  const filters: Rule[] = [];
  for (const key in configObj.filters) {
    if (key !== "rootNotebookPath" && key in rules) {
      const val = configObj.filters[key];
      const rule = await rules[key](val, configObj);
      filters.push(rule);
    }
  }

  const columns: Column[] = [];
  for (const col of configObj.columns) {
    const newCol: Column = {
      name: col.name,
      backlog: col.backlog === true,
      rules: [],
    };

    for (const key in col) {
      const val = col[key];
      if (val && key in rules && typeof val !== "boolean") {
        const rule = await rules[key](val, configObj);
        newCol.rules.push(rule);
      }
    }

    columns.push(newCol);
  }

  let boardState: BoardState = [];
  const board: Board = {
    boardName,
    async updateNotes() {
      boardState = [];

      for (let colIdx = 0; colIdx < columns.length; colIdx++) {
        const col = columns[colIdx];

        let query = createQueryFromRules(filters, false) + " ";
        if (!col.backlog) {
          query += createQueryFromRules(col.rules, false);
        } else {
          const allOtherCols = columns.filter((c: Column) => c !== col);
          query += allOtherCols
            .map((c: Column) => createQueryFromRules(c.rules, true))
            .join(" ");
        }

        boardState.push({
          name: col.name,
          notes: await searchNotes(query),
        });
      }
    },


    processAction({ type, payload }: Action) {
      switch (type) {
        case 'moveNote':

          break
        default:
          throw new Error('Unknown action ' + name)
      }
    },
    
    hasNote: (noteId: string) => !!boardState.find(({ notes }) => notes.find(({ id }) => noteId === id)),
    getState: () => boardState
  };

  return board;
}