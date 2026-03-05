let vipSyncRevision = 0;

export const getVipSyncRevision = (): number => vipSyncRevision;

export const bumpVipSyncRevision = (): number => {
  vipSyncRevision += 1;
  return vipSyncRevision;
};
