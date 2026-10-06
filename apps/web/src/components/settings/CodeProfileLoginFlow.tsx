import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
  type AtomCommandResult,
} from "@t3tools/client-runtime/state/runtime";
import type {
  EnvironmentId,
  ProviderAuthRespondInput,
  ProviderInstanceId,
} from "@t3tools/contracts";
import { lazy, Suspense, useRef, useState } from "react";

import { useEnvironmentQuery } from "../../state/query";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { Button } from "../ui/button";
import { Input } from "../ui/input";

const ProviderAuthTerminal = lazy(() => import("./ProviderAuthTerminal"));

/**
 * Adds a token login to a code profile through the routing Claude instance's
 * sign-in flow: `claude setup-token` in a terminal, or a pasted token. The
 * server captures the token; this only relays the terminal and the form.
 */
export function CodeProfileLoginFlow({
  environmentId,
  instanceId,
  profile,
  readOnly,
}: {
  readonly environmentId: EnvironmentId;
  readonly instanceId: ProviderInstanceId;
  readonly profile: string;
  readonly readOnly: boolean;
}) {
  const query = useEnvironmentQuery(
    serverEnvironment.providerAuthState({ environmentId, input: { instanceId } }),
  );
  const commands = { reportFailure: false, reportDefect: false };
  const start = useAtomCommand(serverEnvironment.startProviderAuth, commands);
  const respond = useAtomCommand(serverEnvironment.respondProviderAuth, commands);
  const cancel = useAtomCommand(serverEnvironment.cancelProviderAuth, commands);
  // The flow is per instance; remember which profile this client started it for.
  const [startedFor, setStartedFor] = useState<string | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const terminalQueue = useRef<ProviderAuthRespondInput[]>([]);
  const terminalSending = useRef(false);
  const auth = query.data;
  const interaction = auth?.interaction;
  const active =
    auth?.phase === "starting" || auth?.phase === "waiting" || auth?.phase === "verifying";
  const mine = startedFor === profile;
  const methods = auth?.methods ?? [];
  const setupMethod = methods.find((method) => method.id === `setup-token:${profile}`);
  const pasteMethod = methods.find((method) => method.id === `paste-token:${profile}`);

  async function run(command: () => Promise<AtomCommandResult<unknown, unknown>>) {
    setError(null);
    const result = await command();
    if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
      const failure = squashAtomCommandFailure(result);
      setError(failure instanceof Error ? failure.message : "Adding the login failed.");
      return false;
    }
    return true;
  }

  const begin = (methodId: string) => {
    setStartedFor(profile);
    setValues({});
    void run(() => start({ environmentId, input: { instanceId, methodId } }));
  };

  if (active && !mine) {
    return <p className="text-xs text-muted-foreground">Another login is being added.</p>;
  }

  return (
    <div className="grid gap-2 text-xs">
      <div className="flex flex-wrap items-center gap-1.5">
        {active && auth?.flowId ? (
          <Button
            size="xs"
            variant="ghost-muted"
            disabled={readOnly}
            onClick={() =>
              void run(() => cancel({ environmentId, input: { instanceId, flowId: auth.flowId! } }))
            }
          >
            Cancel
          </Button>
        ) : (
          <>
            {setupMethod ? (
              <Button
                size="xs"
                variant="outline"
                disabled={readOnly || !auth}
                onClick={() => begin(setupMethod.id)}
              >
                Run claude setup-token
              </Button>
            ) : null}
            {pasteMethod ? (
              <Button
                size="xs"
                variant="ghost-muted"
                disabled={readOnly || !auth}
                onClick={() => begin(pasteMethod.id)}
              >
                Paste a token
              </Button>
            ) : null}
          </>
        )}
        {mine && auth?.phase === "verifying" ? (
          <span className="text-muted-foreground">Saving the login…</span>
        ) : null}
        {mine && !active && auth?.phase === "succeeded" ? (
          <span className="text-muted-foreground">Login added.</span>
        ) : null}
        {mine && !active && auth?.phase === "failed" && auth.message ? (
          <span role="alert" className="text-destructive-foreground">
            {auth.message}
          </span>
        ) : null}
      </div>
      {mine && interaction?.type === "credentials" && auth?.flowId ? (
        <form
          className="grid gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            void run(() =>
              respond({
                environmentId,
                input: {
                  instanceId,
                  flowId: auth.flowId!,
                  interactionId: interaction.id,
                  response: { type: "credentials", values },
                },
              }),
            ).then((sent) => {
              if (sent) setValues({});
            });
          }}
        >
          {interaction.fields.map((field) => (
            <label key={field.name} className="grid gap-1">
              {field.label}
              <Input
                size="sm"
                type={field.secret ? "password" : "text"}
                autoComplete="off"
                spellCheck={false}
                value={values[field.name] ?? ""}
                disabled={readOnly}
                maxLength={field.secret ? 4_096 : 80}
                placeholder={field.name === "name" ? "Work billing" : undefined}
                onChange={(event) => setValues({ ...values, [field.name]: event.target.value })}
              />
            </label>
          ))}
          <Button type="submit" size="xs" variant="outline" className="w-fit" disabled={readOnly}>
            Continue
          </Button>
        </form>
      ) : null}
      {mine && interaction?.type === "terminal" && auth?.flowId ? (
        <Suspense fallback={<p className="text-muted-foreground">Loading terminal…</p>}>
          <ProviderAuthTerminal
            key={`${auth.flowId}:${interaction.id}`}
            output={interaction.output}
            outputOffset={interaction.outputOffset}
            onResponse={(response) => {
              if (readOnly) return;
              terminalQueue.current.push({
                instanceId,
                flowId: auth.flowId!,
                interactionId: interaction.id,
                response,
              });
              if (terminalSending.current) return;
              terminalSending.current = true;
              void (async () => {
                while (terminalQueue.current.length > 0) {
                  const input = terminalQueue.current.shift()!;
                  const result = await respond({ environmentId, input });
                  if (result._tag !== "Success") {
                    terminalQueue.current = [];
                    break;
                  }
                }
              })().finally(() => {
                terminalSending.current = false;
              });
            }}
          />
        </Suspense>
      ) : null}
      {error ? (
        <p role="alert" className="text-destructive-foreground">
          {error}
        </p>
      ) : null}
    </div>
  );
}
