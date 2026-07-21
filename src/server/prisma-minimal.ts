import { prisma } from "@/server/db";

export type ProjectRecord = {
  id: string;
  snapshot: string;
};

export type ProjectVersionRecord = {
  id: string;
  projectId: string;
  label: string;
  snapshot: string;
  createdAt: Date;
};

export type TrackRuleRecord = {
  id: string;
  key: string;
  labelDa: string;
  valueNumber: number | null;
  valueText: string | null;
  unit: string;
  editable: boolean;
};

export type TrackTemplateRecord = {
  id: string;
  code: string;
  name: string;
  description: string;
  rules: string;
  trackRules: TrackRuleRecord[];
};

export type MinimalPrisma = {
  user: {
    upsert(args: unknown): Promise<{ id: string }>;
  };
  project: {
    findFirst(args: unknown): Promise<ProjectRecord | null>;
    findMany(args: unknown): Promise<ProjectRecord[]>;
    create(args: unknown): Promise<ProjectRecord>;
    update(args: unknown): Promise<ProjectRecord>;
    delete(args: unknown): Promise<ProjectRecord>;
  };
  trackTemplate: {
    upsert(args: unknown): Promise<{ id: string }>;
    findFirst(args: unknown): Promise<TrackTemplateRecord | null>;
    findMany(args: unknown): Promise<TrackTemplateRecord[]>;
    update(args: unknown): Promise<TrackTemplateRecord>;
  };
  trackRule: {
    upsert(args: unknown): Promise<unknown>;
  };
  validationSnapshot: {
    create(args: unknown): Promise<unknown>;
  };
  projectVersion: {
    create(args: unknown): Promise<ProjectVersionRecord>;
    findFirst(args: unknown): Promise<ProjectVersionRecord | null>;
    findMany(args: unknown): Promise<ProjectVersionRecord[]>;
  };
};

export const db = prisma as unknown as MinimalPrisma;
