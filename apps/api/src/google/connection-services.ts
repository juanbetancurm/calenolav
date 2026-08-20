import {
  requireTenantRole,
  type AuthenticatedPrincipal,
} from "../auth/session-services.js";

export interface GoogleCalendarConnectionStatusRecord {
  calendarId: string;
  connectedAt: Date;
  googleAccountEmail: string;
  grantedScopes: readonly string[];
  updatedAt: Date;
}

export interface GoogleCalendarConnectionManagementRepository {
  deleteConnection(tenantId: string): Promise<void>;
  findConnectionStatus(
    tenantId: string,
  ): Promise<GoogleCalendarConnectionStatusRecord | null>;
}

interface GoogleCalendarConnectionManagementDependencies {
  repository: GoogleCalendarConnectionManagementRepository;
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
    private readonly dependencies: GoogleCalendarConnectionManagementDependencies,
  ) {}

  async execute(command: GoogleCalendarConnectionCommand): Promise<void> {
    requireTenantRole(command.principal, command.tenantId, "owner");
    await this.dependencies.repository.deleteConnection(command.tenantId);
  }
}
