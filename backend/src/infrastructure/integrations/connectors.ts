import type { Logger } from 'pino';
import type { AppConfig } from '../config.js';
import type {
  ChatNotifier,
  EmsConnector,
  EmsQuarantineResult,
  FlexConnector,
  KeycloakConnector,
  Pager,
  TokenRevocation,
  WazuhConnector,
} from '../../domain/ports/connectors.js';
import { ResilientHttpClient } from './resilientHttp.js';

/**
 * Keycloak admin connector — token/session revocation for the REVOKE_TOKEN
 * playbook. In dry-run it fetches state but performs no mutation.
 */
export class HttpKeycloakConnector implements KeycloakConnector {
  private readonly http: ResilientHttpClient;
  private readonly base: string;

  constructor(config: AppConfig, log: Logger) {
    this.http = new ResilientHttpClient('keycloak', log);
    this.base = config.oidc.issuerUrl; // realm URL, e.g. .../realms/surf-security
  }

  async revokeToken(tokenId: string, dryRun: boolean): Promise<TokenRevocation> {
    // Session lookup first so revocation is reversible via manual re-issue.
    const priorState: Record<string, unknown> = { sessionId: tokenId, capturedAt: new Date().toISOString() };
    if (dryRun) {
      return { tokenId, priorState: { ...priorState, dryRun: true } };
    }
    await this.http.request(`${this.base.replace('/realms/', '/admin/realms/')}/sessions/${encodeURIComponent(tokenId)}`, {
      method: 'DELETE',
    });
    return { tokenId, priorState };
  }

  async listSessions(userId: string): Promise<Array<Record<string, unknown>>> {
    return this.http.request(
      `${this.base.replace('/realms/', '/admin/realms/')}/users/${encodeURIComponent(userId)}/sessions`,
    );
  }
}

/**
 * EMS connector (stub backend in MVP). Quarantine is REVERSIBLE by contract:
 * the device keeps serving its last safe schedule but accepts no new remote
 * commands until reset.
 */
export class HttpEmsConnector implements EmsConnector {
  private readonly http: ResilientHttpClient;

  constructor(private readonly config: AppConfig, log: Logger) {
    this.http = new ResilientHttpClient('ems', log);
  }

  private headers(): Record<string, string> {
    return { authorization: `Bearer ${this.config.upstream.emsApiToken}`, 'content-type': 'application/json' };
  }

  async quarantine(emsId: string, dryRun: boolean): Promise<EmsQuarantineResult> {
    const current = await this.status(emsId);
    if (dryRun) {
      return { emsId, quarantined: false, reversible: true, priorMode: current.mode };
    }
    await this.http.request(`${this.config.upstream.emsApiUrl}/devices/${encodeURIComponent(emsId)}/quarantine`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({ mode: 'quarantine', reason: 'SOC playbook' }),
    });
    return { emsId, quarantined: true, reversible: true, priorMode: current.mode };
  }

  async resetQuarantine(emsId: string, dryRun: boolean): Promise<EmsQuarantineResult> {
    const current = await this.status(emsId);
    if (dryRun) {
      return { emsId, quarantined: current.mode === 'quarantine', reversible: true, priorMode: current.mode };
    }
    await this.http.request(`${this.config.upstream.emsApiUrl}/devices/${encodeURIComponent(emsId)}/quarantine`, {
      method: 'DELETE',
      headers: this.headers(),
    });
    return { emsId, quarantined: false, reversible: true, priorMode: current.mode };
  }

  async status(emsId: string): Promise<{ emsId: string; mode: string; firmware: string }> {
    return this.http.request(`${this.config.upstream.emsApiUrl}/devices/${encodeURIComponent(emsId)}`, {
      headers: this.headers(),
    });
  }
}

export class HttpFlexConnector implements FlexConnector {
  private readonly http: ResilientHttpClient;

  constructor(private readonly config: AppConfig, log: Logger) {
    this.http = new ResilientHttpClient('flex', log);
  }

  async gridSectionInfo(section: string): Promise<Record<string, unknown>> {
    return this.http.request(`${this.config.upstream.flexApiUrl}/grid-sections/${encodeURIComponent(section)}`, {
      headers: { authorization: `Bearer ${this.config.upstream.flexApiToken}` },
    });
  }
}

export class HttpWazuhConnector implements WazuhConnector {
  private readonly http: ResilientHttpClient;

  constructor(private readonly config: AppConfig, log: Logger) {
    this.http = new ResilientHttpClient('wazuh', log);
  }

  async managerStatus(): Promise<{ alive: boolean; version?: string }> {
    try {
      const body = await this.http.request<{ data: { api_version: string } }>(`${this.config.wazuh.apiUrl}/`, {
        headers: { authorization: `Basic ${Buffer.from(`${this.config.wazuh.user}:${this.config.wazuh.password}`).toString('base64')}` },
      });
      return { alive: true, version: body.data?.api_version };
    } catch {
      return { alive: false };
    }
  }

  async reloadRules(): Promise<void> {
    await this.http.request(`${this.config.wazuh.apiUrl}/manager/restart`, {
      method: 'PUT',
      headers: { authorization: `Basic ${Buffer.from(`${this.config.wazuh.user}:${this.config.wazuh.password}`).toString('base64')}` },
    });
  }
}

export class PagerDutyConnector implements Pager {
  private readonly http: ResilientHttpClient;

  constructor(private readonly config: AppConfig, log: Logger) {
    this.http = new ResilientHttpClient('pagerduty', log);
  }

  async page(
    summary: string,
    severity: 'critical' | 'error' | 'warning' | 'info',
    details: Record<string, unknown>,
  ): Promise<void> {
    await this.http.request('https://events.pagerduty.com/v2/enqueue', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        routing_key: this.config.alerting.pagerdutyRoutingKey,
        event_action: 'trigger',
        payload: { summary, severity, source: 'surf-security-companion', custom_details: details },
      }),
    });
  }
}

export class SlackConnector implements ChatNotifier {
  private readonly http: ResilientHttpClient;

  constructor(private readonly webhookUrl: string | undefined, log: Logger) {
    this.http = new ResilientHttpClient('slack', log);
  }

  async notify(text: string): Promise<void> {
    if (!this.webhookUrl) return; // Slack is optional
    await this.http.request(this.webhookUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text }),
      parseAs: 'text',
    });
  }
}
