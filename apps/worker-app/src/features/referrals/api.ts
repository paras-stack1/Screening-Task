import {
  facilityListResponseSchema,
  followUpListResponseSchema,
  followUpResponseSchema,
  referralDashboardSchema,
  referralListResponseSchema,
  referralResponseSchema,
  type ApproveReferralRequest,
  type CompleteFollowUpRequest,
  type CreateFollowUpRequest,
  type CreateReferralRequest,
  type ReferralStatus,
  type ReferralTrackingRequest,
} from '@balswasthya/shared-contracts';
import { z } from 'zod';
import type { ApiClient, RequestOptions } from '../../services/api/client';

/**
 * Referral, facility, follow-up and dashboard calls (docs/step-7/api-documentation.md). Every
 * response is validated against the shared contract; URLs carry opaque ids only. Every change
 * sends the version the screen showed - the API refuses stale writes (409). Who may do what, the
 * consent check at issue and the verification of tracking updates are decided by the API.
 */
export const REFERRALS_PAGE_SIZE = 20;
const dashboardResponse = z.object({ dashboard: referralDashboardSchema });

export type FollowUpFilter = 'mine' | 'overdue' | 'all';

export function createReferralsApi(api: ApiClient) {
  const id = (value: string) => encodeURIComponent(value);
  const referral = (referralId: string) => `/referrals/${id(referralId)}`;
  const followUp = (followUpId: string) => `/follow-ups/${id(followUpId)}`;
  const post = <T>(path: string, body: object, schema: z.ZodType<T>) => api.post(path, body, schema);
  return {
    dashboard: (options?: RequestOptions) => api.get('/dashboards/referrals', dashboardResponse, options),
    list: (
      page: number,
      status: ReferralStatus | null,
      awaitingApproval: boolean,
      options?: RequestOptions,
    ) =>
      api.get(
        `/referrals?page=${page}&pageSize=${REFERRALS_PAGE_SIZE}${status ? `&status=${status}` : ''}${
          awaitingApproval ? '&awaitingApproval=true' : ''
        }`,
        referralListResponseSchema,
        options,
      ),
    get: (referralId: string, options?: RequestOptions) =>
      api.get(referral(referralId), referralResponseSchema, options),
    create: (body: CreateReferralRequest) => post('/referrals', body, referralResponseSchema),
    approve: (referralId: string, body: ApproveReferralRequest) =>
      post(`${referral(referralId)}/approve`, body, referralResponseSchema),
    reject: (referralId: string, expectedVersion: number, reason: string) =>
      post(`${referral(referralId)}/reject`, { expectedVersion, reason }, referralResponseSchema),
    changeFacility: (
      referralId: string,
      expectedVersion: number,
      facilityId: string,
      outOfDistrictReason?: string,
    ) =>
      api.patch(
        `${referral(referralId)}/facility`,
        { expectedVersion, facilityId, ...(outOfDistrictReason ? { outOfDistrictReason } : {}) },
        referralResponseSchema,
      ),
    issue: (referralId: string, expectedVersion: number) =>
      post(`${referral(referralId)}/issue`, { expectedVersion }, referralResponseSchema),
    cancel: (referralId: string, expectedVersion: number, reason: string) =>
      post(`${referral(referralId)}/cancel`, { expectedVersion, reason }, referralResponseSchema),
    track: (referralId: string, body: ReferralTrackingRequest) =>
      post(`${referral(referralId)}/tracking`, body, referralResponseSchema),
    close: (referralId: string, expectedVersion: number, reason: string) =>
      post(`${referral(referralId)}/close`, { expectedVersion, reason }, referralResponseSchema),
    correct: (referralId: string, expectedVersion: number, eventId: string, reason: string) =>
      post(
        `${referral(referralId)}/corrections`,
        { expectedVersion, eventId, reason },
        referralResponseSchema,
      ),
    reassess: (referralId: string, impactId: string) =>
      post(`${referral(referralId)}/reassessments/${id(impactId)}`, {}, referralResponseSchema),

    facilities: (childId: string, includeOutOfDistrict: boolean, options?: RequestOptions) =>
      api.get(
        `/facilities?childId=${id(childId)}${includeOutOfDistrict ? '&includeOutOfDistrict=true' : ''}`,
        facilityListResponseSchema,
        options,
      ),

    followUps: (page: number, filter: FollowUpFilter, referralId: string | null, options?: RequestOptions) =>
      api.get(
        `/follow-ups?page=${page}&pageSize=${REFERRALS_PAGE_SIZE}${filter === 'mine' ? '&assigned=mine' : ''}${
          filter === 'overdue' ? '&overdue=true' : ''
        }${referralId ? `&referralId=${id(referralId)}` : ''}`,
        followUpListResponseSchema,
        options,
      ),
    followUp: (followUpId: string, options?: RequestOptions) =>
      api.get(followUp(followUpId), followUpResponseSchema, options),
    createFollowUp: (body: CreateFollowUpRequest) => post('/follow-ups', body, followUpResponseSchema),
    startFollowUp: (followUpId: string, expectedVersion: number) =>
      post(`${followUp(followUpId)}/start`, { expectedVersion }, followUpResponseSchema),
    completeFollowUp: (followUpId: string, body: CompleteFollowUpRequest) =>
      post(`${followUp(followUpId)}/complete`, body, followUpResponseSchema),
    rescheduleFollowUp: (followUpId: string, expectedVersion: number, dueDate: string, reason: string) =>
      post(
        `${followUp(followUpId)}/reschedule`,
        { expectedVersion, dueDate, reason },
        followUpResponseSchema,
      ),
    missFollowUp: (followUpId: string, expectedVersion: number, reason: string) =>
      post(`${followUp(followUpId)}/miss`, { expectedVersion, reason }, followUpResponseSchema),
    cancelFollowUp: (followUpId: string, expectedVersion: number, reason: string) =>
      post(`${followUp(followUpId)}/cancel`, { expectedVersion, reason }, followUpResponseSchema),
  };
}

export type ReferralsApi = ReturnType<typeof createReferralsApi>;
