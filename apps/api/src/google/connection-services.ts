import {
  requireTenantRole,
  type AuthenticatedPrincipal,
} from "../auth/session-services.js";
import type { EncryptedSecret } from "./secret-box.js";

export interface GoogleCalendarConnectionStatusRecord {
  calendarId: string;
  connectedAt: Date;
  googleAccountEmail: string;
  grantedScopes: readonly string[];
  updatedAt: Date;
}

export interface GoogleCalendarConnectionManagementRepository {
  findConnectionStatus(
    tenantId: string,
  ): Promise<GoogleCalendarConnectionStatusRecord | null>;
  takeConnectionForDisconnect(
    tenantId: string,
  ): Promise<{ refreshToken: EncryptedSecret } | null>;
}

interface GoogleCalendarConnectionManagementDependencies {
  repository: GoogleCalendarConnectionManagementRepository;
}

interface DisconnectGoogleCalendarDependencies
  extends GoogleCalendarConnectionManagementDependencies {
  grantRevoker?: {
    revokeGrant(refreshToken: string): Promise<void>;
  };
  secretBox?: {
    decrypt(encrypted: EncryptedSecret, context: string): string;
  };
}

export interface GoogleCalendarConnectionCommand {
  principal: AuthenticatedPrincipal;
  tenantId: string;
}

export type GoogleCalendarConnectionStatus =
  | {
      connected: false;
      tenantId: string;
    }
  | ({
      connected: true;
      tenantId: string;
    } & GoogleCalendarConnectionStatusRecord);

export class GetGoogleCalendarConnectionStatusService {
  constructor(
    private readonly dependencies: GoogleCalendarConnectionManagementDependencies,
  ) {}

  async execute(
    command: GoogleCalendarConnectionCommand,
  ): Promise<GoogleCalendarConnectionStatus> {
    requireTenantRole(command.principal, command.tenantId, "owner");
    const connection = await this.dependencies.repository.findConnectionStatus(
      command.tenantId,
    );

    if (!connection) {
      return { connected: false, tenantId: command.tenantId };
    }

    return {
      calendarId: connection.calendarId,
      connected: true,
      connectedAt: connection.connectedAt,
      googleAccountEmail: connection.googleAccountEmail,
      grantedScopes: [...connection.grantedScopes],
      tenantId: command.tenantId,
      updatedAt: connection.updatedAt,
    };
  }
}

export class DisconnectGoogleCalendarService {
  constructor(
    private readonly dependencies: DisconnectGoogleCalendarDependencies,
  ) {}

  async execute(command: GoogleCalendarConnectionCommand): Promise<void> {
    requireTenantRole(command.principal, command.tenantId, "owner");
    const connection =
      await this.dependencies.repository.takeConnectionForDisconnect(
        command.tenantId,
      );

    if (
      !connection ||
      !this.dependencies.grantRevoker ||
      !this.dependencies.secretBox
    ) {
      return;
    }

    try {
      const refreshToken = this.dependencies.secretBox.decrypt(
        connection.refreshToken,
        `google-refresh-token:${command.tenantId}`,
      );
      await this.dependencies.grantRevoker.revokeGrant(refreshToken);
    } catch {
      // Local deletion is authoritative; provider revocation is best effort.
    }
  }
}
