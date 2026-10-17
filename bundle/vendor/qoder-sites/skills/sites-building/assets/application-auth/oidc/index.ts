import { createSiteContext, createDatabaseClient, errorResponse } from './_qoder/backend.mjs';
import { createAppAuth } from './auth.mjs';
import { createBusiness } from '../business.mjs';
import { applicationPath, applicationError, createEnv } from '../shared.mjs';

const env = createEnv((name: string) => Deno.env.get(name));
const auth = createAppAuth({ env });
const business = createBusiness({ db: createDatabaseClient(), auth, env });
Deno.serve(async request => {
  let ctx;
  try {
    ctx = createSiteContext(request, { forwardApplicationCredentials: true });
    if (applicationPath(ctx.request).startsWith('/auth/')) return await auth.handle(ctx.request);
    return await business(ctx);
  } catch (error) { return applicationError(error, e => errorResponse(e, ctx?.requestId)); }
});
