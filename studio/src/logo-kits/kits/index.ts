/**
 * @file The source-kit registry — the single list of every framework-authored
 * logo kit. Both the client catalog and the generator read this, so a new kit
 * is added in exactly one place and appears everywhere.
 */

import type { LogoKitInput } from "../types";
import { AMBER_MOTION } from "./amber-motion";
import { X_THROB } from "./x-throb";

export const SOURCE_KITS: LogoKitInput[] = [X_THROB, AMBER_MOTION];
