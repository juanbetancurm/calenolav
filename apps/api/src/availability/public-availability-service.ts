import { GOOGLE_CALENDAR_FREEBUSY_SCOPE } from "../google/oauth-authorization.js";
import type { EncryptedSecret } from "../google/secret-box.js";
import {
  calculateAvailabilityQueryRange,
  calculateAvailableSlots,
  type AvailabilitySlot,
  type BusyInterval,
} from "./slot-calculator.js";
import type { AvailabilityPolicy } from "./weekly-policy.js";

export interface PublicAvailabilitySource {
  calendarId: string;
  grantedScopes: readonly string[];
  policy: AvailabilityPolicy;
  refreshToken: EncryptedSecret;
  tenantId: string;
}

export interface PublicAvailabilityRepository {
  findSourceBySlug(slug: string): Promise<PublicAvailabilitySource | null>;
}

interface PublicAvailabilityFreeBusyClient {
  queryBusyIntervals(input: {
    calendarId: string;
    endAt: Date;
    refreshToken: string;
    startAt: Date;
  }): Promise<BusyInterval[]>;
}

interface PublicAvailabilitySecretBox {
  decrypt(encrypted: EncryptedSecret, context: string): string;
}

interface GetPublicAvailabilityDependencies {
  clock: () => Date;
  freeBusyClient: PublicAvailabilityFreeBusyClient;
  repository: PublicAvailabilityRepository;
  secretBox: PublicAvailabilitySecretBox;
}

export interface GetPublicAvailabilityResult {
  slots: AvailabilitySlot[];
}

export class PublicAvailabilityNotFoundError extends Error {
  override readonly name = "PublicAvailabilityNotFoundError";

  constructor() {
    super("Public availability was not found.");
  }
}

export class PublicAvailabilityUnavailableError extends Error {
  override readonly name = "PublicAvailabilityUnavailableError";

  constructor() {
    super("Public availability is temporarily unavailable.");
  }
}

const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;

export class GetPublicAvailabilityService {
  constructor(private readonly dependencies: GetPublicAvailabilityDependencies) {}

  async execute(input: { slug: string }): Promise<GetPublicAvailabilityResult> {
    const slug = input.slug.trim().toLowerCase();
    if (slug.length === 0 || slug.length > 63 || !slugPattern.test(slug)) {
      throw new PublicAvailabilityNotFoundError();
    }

    let source: PublicAvailabilitySource | null;
    try {
      source = await this.dependencies.repository.findSourceBySlug(slug);
    } catch {
      throw new PublicAvailabilityUnavailableError();
    }

    if (
      !source ||
      !source.grantedScopes.includes(GOOGLE_CALENDAR_FREEBUSY_SCOPE)
    ) {
      throw new PublicAvailabilityNotFoundError();
    }

    try {
      const now = this.dependencies.clock();
      if (source.policy.windows.length === 0) {
        return {
          slots: calculateAvailableSlots({
            busyIntervals: [],
            now,
            policy: source.policy,
          }),
        };
      }

      const queryRange = calculateAvailabilityQueryRange({
        now,
        policy: source.policy,
      });
      const refreshToken = this.dependencies.secretBox
        .decrypt(
          source.refreshToken,
          `google-refresh-token:${source.tenantId}`,
        )
        .trim();
      if (refreshToken.length === 0) {
        throw new PublicAvailabilityUnavailableError();
      }
      const busyIntervals =
        await this.dependencies.freeBusyClient.queryBusyIntervals({
          calendarId: source.calendarId,
          endAt: queryRange.endAt,
          refreshToken,
          startAt: queryRange.startAt,
        });

      return {
        slots: calculateAvailableSlots({
          busyIntervals,
          now,
          policy: source.policy,
        }),
      };
    } catch {
      throw new PublicAvailabilityUnavailableError();
    }
  }
}
