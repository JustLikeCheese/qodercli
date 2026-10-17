import { createSiteContext, createDatabaseClient, errorResponse } from './_qoder/backend.mjs';
import { createExistingAuth } from './auth.mjs';
import { createBusiness } from '../business.mjs';
import { applicationError } from '../shared.mjs';

const env = (name: string) => Deno.env.get(name);
const handle = createBusiness({ db: createDatabaseClient(), auth: createExistingAuth({ env }), env });
Deno.serve(async request => {
  try { return await handle(createSiteContext(request, { forwardApplicationCredentials: true })); }
  catch (error) { return applicationError(error, errorResponse); }
});
