import {
  childDetailResponseSchema,
  childListResponseSchema,
  guardianDetailResponseSchema,
  guardianLinkListResponseSchema,
  guardianLinkResponseSchema,
  registrationAreasResponseSchema,
  parentPortalStatusResponseSchema,
  type CreateParentInvitationRequest,
  childConsentsResponseSchema,
  consentNoticesResponseSchema,
  consentRecordResponseSchema,
  type RecordConsentRequest,
  type WithdrawConsentRequest,
  type AddGuardianLinkRequest,
  type RegisterChildRequest,
  type UpdateChildRequest,
  type UpdateGuardianLinkRequest,
  type UpdateGuardianRequest,
} from '@balswasthya/shared-contracts';
import type { ApiClient, RequestOptions } from '../../services/api/client';

/**
 * Child, guardian and guardian-link calls (docs/api/children.md). Every response is validated
 * against the shared contract. IDs in paths are opaque UUIDs - never names or phone numbers.
 */
export const CHILD_PAGE_SIZE = 20;

export function createChildrenApi(api: ApiClient) {
  const id = (value: string) => encodeURIComponent(value);
  return {
    list: (
      params: { search?: string; page: number; pageSize?: number; sort?: string },
      options?: RequestOptions,
    ) => {
      const query = new URLSearchParams({
        page: String(params.page),
        pageSize: String(params.pageSize ?? CHILD_PAGE_SIZE),
        sort: params.sort ?? 'fullName',
      });
      if (params.search) query.set('search', params.search);
      return api.get(`/children?${query.toString()}`, childListResponseSchema, options);
    },
    get: (childId: string, options?: RequestOptions) =>
      api.get(`/children/${id(childId)}`, childDetailResponseSchema, options),
    register: (body: RegisterChildRequest) => api.post('/children', body, childDetailResponseSchema),
    update: (childId: string, body: UpdateChildRequest) =>
      api.patch(`/children/${id(childId)}`, body, childDetailResponseSchema),
    registrationAreas: (options?: RequestOptions) =>
      api.get('/children/registration-areas', registrationAreasResponseSchema, options),
    links: (childId: string, includeEnded: boolean, options?: RequestOptions) =>
      api.get(
        `/children/${id(childId)}/guardians?includeEnded=${String(includeEnded)}`,
        guardianLinkListResponseSchema,
        options,
      ),
    addLink: (childId: string, body: AddGuardianLinkRequest) =>
      api.post(`/children/${id(childId)}/guardians`, body, guardianLinkResponseSchema),
    updateLink: (childId: string, relationshipId: string, body: UpdateGuardianLinkRequest) =>
      api.patch(`/children/${id(childId)}/guardians/${id(relationshipId)}`, body, guardianLinkResponseSchema),
    endLink: (childId: string, relationshipId: string, reason: string) =>
      api.delete(
        `/children/${id(childId)}/guardians/${id(relationshipId)}`,
        { reason },
        guardianLinkResponseSchema,
      ),
    guardian: (guardianId: string, options?: RequestOptions) =>
      api.get(`/guardians/${id(guardianId)}`, guardianDetailResponseSchema, options),
    // ------------------------------------------------------------ consent (docs/api/consent.md)
    consents: (childId: string, options?: RequestOptions) =>
      api.get(`/children/${id(childId)}/consents`, childConsentsResponseSchema, options),
    consentNotices: (language: 'hi' | 'en', options?: RequestOptions) =>
      api.get(`/consent-notices?language=${language}`, consentNoticesResponseSchema, options),
    recordConsent: (childId: string, body: RecordConsentRequest) =>
      api.post(`/children/${id(childId)}/consents`, body, consentRecordResponseSchema),
    withdrawConsent: (childId: string, consentId: string, body: WithdrawConsentRequest) =>
      api.post(
        `/children/${id(childId)}/consents/${id(consentId)}/withdraw`,
        body,
        consentRecordResponseSchema,
      ),
    updateGuardian: (guardianId: string, body: UpdateGuardianRequest) =>
      api.patch(`/guardians/${id(guardianId)}`, body, guardianDetailResponseSchema),
    // --------------------------------------- Parent Portal invitations (Step 8, docs/api/parent-portal.md)
    parentPortal: (guardianId: string, options?: RequestOptions) =>
      api.get(`/guardians/${id(guardianId)}/invitations`, parentPortalStatusResponseSchema, options),
    inviteParent: (guardianId: string, body: CreateParentInvitationRequest) =>
      api.post(`/guardians/${id(guardianId)}/invitations`, body, parentPortalStatusResponseSchema),
    revokeParentInvitation: (guardianId: string, invitationId: string, reason: string) =>
      api.post(
        `/guardians/${id(guardianId)}/invitations/${id(invitationId)}/revoke`,
        { reason },
        parentPortalStatusResponseSchema,
      ),
  };
}

export type ChildrenApi = ReturnType<typeof createChildrenApi>;
