/**
 * @file The source-landing registry — every framework-authored x_landing, in
 * one list read by both the catalog and the generator.
 */

import type { XLandingInput } from "../types";
import { LOGIN_LANDING } from "./login-landing";

export const SOURCE_LANDINGS: XLandingInput[] = [LOGIN_LANDING];
