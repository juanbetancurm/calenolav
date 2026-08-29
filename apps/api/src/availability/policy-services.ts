import {
  requireTenantRole,
  type AuthenticatedPrincipal,
} from "../auth/session-services.js";
import {
  normalizeAvailabilityPolicy,
  type AvailabilityPolicy,
} from "./weekly-policy.js";

export interface AvailabilityPolicyRepository {
  findPolicy(tenantId: string): Promise<AvailabilityPolicy | null>;
  replacePolicy(tenantId: string, policy: AvailabilityPolicy): Promise<void>;
}

interface AvailabilityPolicyServiceDependencies {
  repository: AvailabilityPolicyRepository;
}

interface TenantAvailabilityPolicyCommand {
  principal: AuthenticatedPrincipal;
  tenantId: string;
}

interface ReplaceTenantAvailabilityPolicyCommand
  extends TenantAvailabilityPolicyCommand {
  policy: AvailabilityPolicy;
}

export interface TenantAvailabilityPolicyResult {
  policy: AvailabilityPolicy | null;
  tenantId: string;
}

export class GetTenantAvailabilityPolicyService {
  constructor(
    private readonly dependencies: AvailabilityPolicyServiceDependencies,
  ) {}

  async execute(
    command: TenantAvailabilityPolicyCommand,
  ): Promise<TenantAvailabilityPolicyResult> {
    requireTenantRole(command.principal, command.tenantId, "owner");
    const policy = await this.dependencies.repository.findPolicy(
      command.tenantId,
    );
    return { policy, tenantId: command.tenantId };
  }
}

export class ReplaceTenantAvailabilityPolicyService {
  constructor(
    private readonly dependencies: AvailabilityPolicyServiceDependencies,
  ) {}

  async execute(
    command: ReplaceTenantAvailabilityPolicyCommand,
  ): Promise<TenantAvailabilityPolicyResult & { policy: AvailabilityPolicy }> {
    requireTenantRole(command.principal, command.tenantId, "owner");
    const policy = normalizeAvailabilityPolicy(command.policy);
    await this.dependencies.repository.replacePolicy(command.tenantId, policy);
    return { policy, tenantId: command.tenantId };
  }
}