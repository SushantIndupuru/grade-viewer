/// <reference types="astro/client" />

import type { Gradebook } from "./lib/studentvue/types";

interface ImportMetaEnv {
	readonly PUBLIC_DEFAULT_DISTRICT_URL?: string;
	readonly PUBLIC_WISP_URL?: string;
	readonly PUBLIC_WISP_URL_2?: string;
	readonly PUBLIC_STUDENTVUE_TRANSPORT?: string;
	readonly PUBLIC_STUDENTVUE_AUTH?: string;
	readonly SUPABASE_URL?: string;
	readonly SUPABASE_SERVICE_ROLE_KEY?: string;
	readonly PUBLIC_LOGIN_HASH_PEPPER?: string;
}

interface ImportMeta {
	readonly env: ImportMetaEnv;
}

declare namespace App {
	interface SessionData {
		creds?: {
			username: string;
			password: string;
			districtUrl: string;
			accessToken?: string;
			refreshToken?: string;
		};
		student?: {
			name: string;
			school: string;
			grade: string;
			email: string;
		};
		gradebookCache?: {
			period: string;
			fetchedAt: number;
			gradebook: Gradebook;
		};
	}
}
