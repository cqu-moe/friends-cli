import { lstat, readFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import type { CourseQuestionnaireAnswerInput } from "./course-participation.js";
import { FriendsError, FriendsErrorCode } from "./errors.js";

export async function loadCourseQuestionnaireFiles(value: unknown): Promise<{
  answers: CourseQuestionnaireAnswerInput[] | undefined;
  paths: Record<string, string[]>;
}> {
  const paths: Record<string, string[]> = Object.create(null);
  if (value === undefined) return { answers: undefined, paths };
  const invalid = (message: string): never => { throw new FriendsError({ code: FriendsErrorCode.InvalidInput, message }); };
  if (!Array.isArray(value)) invalid("questionnaire must be an array");
  const answers: CourseQuestionnaireAnswerInput[] = [];
  for (const raw of value as unknown[]) {
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) invalid("Each questionnaire answer must be an object");
    const answer = raw as Record<string, unknown>;
    if (answer.attachments === undefined) { answers.push(answer as unknown as CourseQuestionnaireAnswerInput); continue; }
    if (typeof answer.questionId !== "string" || !answer.questionId || !Array.isArray(answer.attachments)) invalid("Questionnaire attachments require questionId and an array");
    if (["text", "choiceOptionId", "choiceOptionIds"].some(key => answer[key] !== undefined)) invalid("Each questionnaire answer must use exactly one answer type");
    const questionId = answer.questionId as string;
    paths[questionId] = [];
    const attachments = [];
    for (const item of answer.attachments as unknown[]) {
      if (typeof item !== "object" || item === null || Array.isArray(item)) invalid("Each attachment must be an object");
      const file = item as Record<string, unknown>;
      if (typeof file.path !== "string" || !file.path.trim() || typeof file.mimeType !== "string" || !file.mimeType.trim()) invalid("Each questionnaire attachment requires path and mimeType");
      const path = resolve(file.path as string);
      let bytes: Buffer;
      try {
        const stat = await lstat(path);
        if (!stat.isFile() || stat.isSymbolicLink() || stat.size < 1 || stat.size > 20 * 1024 * 1024) invalid("Questionnaire attachments must be non-empty regular files up to 20 MiB");
        bytes = await readFile(path);
      } catch (cause) {
        if (cause instanceof FriendsError) throw cause;
        invalid("Could not read questionnaire attachment");
      }
      if (file.filename !== undefined && (typeof file.filename !== "string" || !file.filename.trim())) invalid("Attachment filename must be non-empty");
      attachments.push({ content: new File([new Uint8Array(bytes!)], file.filename as string | undefined ?? basename(path), { type: file.mimeType as string }) });
      paths[questionId].push(path);
    }
    answers.push({ questionId, attachments });
  }
  return { answers, paths };
}
