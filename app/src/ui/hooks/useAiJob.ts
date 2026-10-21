// One AI request at a time for the open document (ADR-30). The text so far is shown while it is
// written but saved only when the reply is complete; leaving the document stops the request.
import { useEffect, useRef, useState } from 'preact/hooks';
import { runAi } from '../../core/ai/assistant';
import type { AiScope, AiTask } from '../../core/ai/prompts';
import { AiError, isAbort, type AiErrorKind } from '../../core/ai/provider';
import type { AiResult, ParsedDocument } from '../../core/types';
import { aiReady } from '../ai';
import { useServices } from '../services';

export interface AiStep {
  scope: AiScope;
  task: AiTask;
  /** What is being written, for the reader: "Summary of page 12". */
  label: string;
}

export interface AiJob {
  scopeKey: string;
  label: string;
  text: string;
  /** "2 of 12" while several chapters are summarised one after another. */
  progress?: string;
}

export interface AiProblem {
  scopeKey: string;
  message: string;
  kind: AiErrorKind | 'stopped' | 'off';
}

export function useAiJob(docId: string, doc: ParsedDocument | null, onStored: (rs: AiResult[]) => void) {
  const services = useServices();
  const [job, setJob] = useState<AiJob | null>(null);
  const [problem, setProblem] = useState<AiProblem | null>(null);
  const ctl = useRef<AbortController | null>(null);
  const stored = useRef(onStored);
  stored.current = onStored;

  // Leaving the document, or the reader, stops a request that is still running.
  useEffect(
    () => () => {
      ctl.current?.abort();
      ctl.current = null;
    },
    [docId],
  );

  const run = async (steps: AiStep[], question?: string): Promise<boolean> => {
    if (!doc || ctl.current || steps.length === 0) return false;
    const first = steps[0]!;
    const ready = await aiReady(services);
    if (!ready) {
      setProblem({ scopeKey: first.scope.key, kind: 'off', message: 'Add your own key for Claude, ChatGPT or Gemini in Settings first.' });
      return false;
    }
    const ac = new AbortController();
    ctl.current = ac;
    setProblem(null);
    let shown = '';
    let frame = 0;
    let done = 0;
    try {
      for (const [i, step] of steps.entries()) {
        const progress = steps.length > 1 ? `${i + 1} of ${steps.length}` : undefined;
        const base = { scopeKey: first.scope.key, label: step.label, ...(progress ? { progress } : {}) };
        setJob({ ...base, text: '' });
        const rs = await runAi({ ...ready, store: services.repo }, docId, doc, step.scope, step.task, {
          ...(question ? { question } : {}),
          signal: ac.signal,
          // At most one repaint per frame however fast the text arrives.
          onText: (t) => {
            shown = t;
            if (!frame) frame = requestAnimationFrame(() => ((frame = 0), setJob({ ...base, text: shown })));
          },
        });
        cancelAnimationFrame(frame);
        frame = 0;
        done++;
        stored.current(rs);
      }
      return true;
    } catch (e) {
      cancelAnimationFrame(frame);
      const saved = done > 0 ? ` ${done} of ${steps.length} finished first and ${done === 1 ? 'is' : 'are'} kept.` : '';
      if (isAbort(e)) {
        if (ctl.current === ac) setProblem({ scopeKey: first.scope.key, kind: 'stopped', message: `Stopped. The unfinished reply was not saved.${saved}` });
      } else if (e instanceof AiError) {
        setProblem({ scopeKey: first.scope.key, kind: e.kind, message: `${e.message}${saved}` });
      } else {
        setProblem({ scopeKey: first.scope.key, kind: 'server', message: `Something went wrong: ${(e as Error).message}.${saved}` });
      }
      return false;
    } finally {
      if (ctl.current === ac) {
        ctl.current = null;
        setJob(null);
      }
    }
  };

  return {
    job,
    problem,
    run,
    stop: () => ctl.current?.abort(),
    clearProblem: () => setProblem(null),
  };
}
