import { OrchestraError } from "../core/errors";
import type { Waker } from "../core/service";

const GITHUB_API = "https://api.github.com";

/**
 * Starts a codespace: POST /user/codespaces/{name}/start.
 * The token needs the `codespace` scope (classic PAT) and must belong to the codespace owner.
 */
export function githubWaker(token: string, fetchFn: typeof fetch = fetch): Waker {
  return async (codespaceName) => {
    const response = await fetchFn(`${GITHUB_API}/user/codespaces/${encodeURIComponent(codespaceName)}/start`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        accept: "application/vnd.github+json",
        "x-github-api-version": "2022-11-28",
        "user-agent": "orchestra-man",
      },
    });
    if (response.status === 304) return "Available";
    if (!response.ok) {
      throw new OrchestraError("unavailable", `GitHub refused to start ${codespaceName}: HTTP ${response.status}`);
    }
    const body = (await response.json()) as { state?: unknown };
    return typeof body.state === "string" ? body.state : "Unknown";
  };
}
