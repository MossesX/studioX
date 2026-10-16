"use client";

/**
 * @file The `@mui/icons-material` → branding-glyph shim, ported from GizmoX's
 * `components/brand/mui.tsx` for the AmberX Vid module.
 *
 * Every icon import in the ported screens resolves here: each export renders
 * the mapped AmberX branding glyph through `Glyph` from `@axf/core` — `1em`
 * box, MUI `fontSize`/`sx` dialect intact. The mapping is deliberately
 * many-to-one (the pack is a brand vocabulary, not a 1:1 Material clone);
 * directional variants reuse one glyph rotated. Never import
 * `@mui/icons-material`.
 *
 * PORT NOTE — glyph id mapping (GizmoX pack id → AmberX 42-id contract),
 * by meaning; drift is accepted per the 2026-08-13 port record in PLANNING-STATE.md:
 *
 *   badge-bang      → icon-bolt        (alert)
 *   badge-dot       → icon-ellipse
 *   badge-dot-ring  → icon-ellipse
 *   badge-star      → icon-sparkle     (at 0.45 opacity, to keep the
 *                                       filled/outline star distinction)
 *   badge-tick      → icon-line        (a check is a stroked line)
 *   icon-bell       → icon-chat        (notifications/voice)
 *   icon-bolt       → icon-bolt
 *   icon-book       → icon-book
 *   icon-bookmark   → icon-book
 *   icon-bot        → icon-sparkle     (AI)
 *   icon-brush      → icon-brush
 *   icon-bucket     → icon-fill
 *   icon-chat       → icon-chat
 *   icon-check      → icon-line
 *   icon-chevron    → icon-chevron-down, rotation rebased −90° (GizmoX's
 *                     base chevron points RIGHT, AmberX's points DOWN);
 *                     up-pointing variants use icon-chevron-up directly
 *   icon-clock      → icon-history
 *   icon-close      → icon-plus ∠45    (an X is a rotated +)
 *   icon-cloud      → icon-globe
 *   icon-code       → icon-terminal
 *   icon-copy       → icon-compare     (two of a thing)
 *   icon-cursor     → icon-picker
 *   icon-database   → icon-layers      (stacked disks)
 *   icon-dock       → icon-compare     (side panel = split)
 *   icon-download   → icon-chevron-down
 *   icon-drag       → icon-grid        (dot grid)
 *   icon-edit       → icon-brush
 *   icon-ellipse    → icon-ellipse
 *   icon-eraser     → icon-eraser
 *   icon-external   → icon-expand
 *   icon-eye        → icon-eye
 *   icon-eyedropper → icon-picker
 *   icon-file       → icon-book        (document)
 *   icon-filter     → icon-filter      (the Off variant uses the contract's
 *                                       real icon-filter-off)
 *   icon-flash      → icon-bolt
 *   icon-flask      → icon-sparkle
 *   icon-folder     → icon-folder
 *   icon-gear       → icon-gear
 *   icon-globe      → icon-globe
 *   icon-grid       → icon-grid
 *   icon-hierarchy  → icon-layers
 *   icon-home       → mark             (home = the app's own mark)
 *   icon-image      → icon-rect
 *   icon-info       → icon-book        (learn more)
 *   icon-json       → icon-terminal
 *   icon-key        → icon-account     (auth family)
 *   icon-keyboard   → icon-keyboard
 *   icon-layers     → icon-layers
 *   icon-link       → icon-sync        (connection)
 *   icon-lock       → icon-account
 *   icon-maximize   → icon-expand
 *   icon-minimize   → icon-collapse
 *   icon-minus      → icon-line
 *   icon-more       → icon-grid        (dots)
 *   icon-palette    → icon-palette
 *   icon-pane       → icon-layers      (stacked rows; distinct from grid view)
 *   icon-pause      → icon-compare     (two vertical bars)
 *   icon-pin        → icon-picker
 *   icon-play       → icon-play
 *   icon-plugin     → icon-plugin
 *   icon-plus       → icon-plus
 *   icon-power      → icon-bolt
 *   icon-redo       → icon-reload
 *   icon-refresh    → icon-reload      (the export named `Sync` uses the
 *                                       contract's real icon-sync)
 *   icon-save       → icon-folder      (storage)
 *   icon-search     → icon-search
 *   icon-send       → icon-play        (right-pointing triangle ≈ paper plane)
 *   icon-shield     → icon-account     (admin = user management here)
 *   icon-sparkle    → icon-sparkle
 *   icon-split-h    → icon-compare
 *   icon-split-v    → icon-compare ∠90
 *   icon-stack      → icon-layers
 *   icon-star       → icon-sparkle
 *   icon-stop       → icon-rect        (stop = square)
 *   icon-subgrid    → icon-grid
 *   icon-tab        → icon-wrap        (bent arrow)
 *   icon-tag        → icon-rect
 *   icon-target     → icon-ellipse
 *   icon-terminal   → icon-terminal
 *   icon-toolbar    → icon-filter      (tune/sliders)
 *   icon-trash      → icon-trash
 *   icon-tree       → icon-wrap
 *   icon-undo       → icon-history     (back in time)
 *   icon-user       → icon-account
 *   icon-warning    → icon-bolt
 *   icon-window     → icon-rect
 */

import * as React from "react";
import Box from "@mui/material/Box";
import type { SxProps, Theme } from "@mui/material/styles";
import { Glyph } from "@axf/core";

/** MUI `SvgIcon`-dialect props the ported call sites use. */
export interface BrandMuiIconProps {
  sx?: SxProps<Theme>;
  style?: React.CSSProperties;
  className?: string;
  /** MUI keyword or a CSS length; call sites mostly size via `sx.fontSize`. */
  fontSize?: "inherit" | "small" | "medium" | "large" | number | string;
  color?: string;
  titleAccess?: string;
  onClick?: React.MouseEventHandler;
}

const FONT_SIZES: Record<string, string> = {
  inherit: "inherit",
  small: "1.25rem",
  medium: "1.5rem",
  large: "2.1875rem"
};

function mk(id: string, rotate?: number, opacity?: number): React.FC<BrandMuiIconProps> {
  const C: React.FC<BrandMuiIconProps> = ({
    sx,
    style,
    className,
    fontSize = "medium",
    color,
    titleAccess,
    onClick
  }) => (
    <Box
      component="span"
      className={className}
      onClick={onClick}
      title={titleAccess}
      sx={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: "1em",
        height: "1em",
        // Same convention as GizmoX's BrandIcon: a 1em box whose fontSize is
        // the MUI keyword scale (medium = 1.5rem/24px); sx.fontSize overrides.
        fontSize:
          typeof fontSize === "number" ? fontSize : (FONT_SIZES[fontSize] ?? fontSize),
        lineHeight: 0,
        flexShrink: 0,
        verticalAlign: "middle",
        ...(color ? { color } : null),
        ...(sx as object)
      }}
      style={{
        ...(rotate ? { transform: `rotate(${rotate}deg)` } : null),
        ...(opacity != null ? { opacity } : null),
        ...style
      }}
    >
      <Glyph id={id} size="1em" />
    </Box>
  );
  C.displayName = `Brand(${id}${rotate ? `∠${rotate}` : ""})`;
  return C;
}

/* ------------------------------------ A ------------------------------------ */
export const AccountTree = mk("icon-layers");
export const Add = mk("icon-plus");
export const AddComment = mk("icon-chat");
export const AddPhotoAlternate = mk("icon-rect");
export const AddTask = mk("icon-line");
export const AlignHorizontalCenter = mk("icon-compare");
export const AlignHorizontalLeft = mk("icon-compare");
export const AlignHorizontalRight = mk("icon-compare");
export const AlignVerticalBottom = mk("icon-compare", 90);
export const AlignVerticalCenter = mk("icon-compare", 90);
export const AlignVerticalTop = mk("icon-compare", 90);
export const AltRoute = mk("icon-layers");
export const Apps = mk("icon-grid");
export const Archive = mk("icon-layers");
export const ArrowBack = mk("icon-chevron-down", 90);
export const ArrowDownward = mk("icon-chevron-down");
export const ArrowDropDown = mk("icon-chevron-down");
export const ArrowDropDownCircle = mk("icon-chevron-down");
export const ArrowForward = mk("icon-chevron-down", -90);
export const ArrowUpward = mk("icon-chevron-up");
export const Article = mk("icon-book");
export const ArticleOutlined = mk("icon-book");
export const AttachMoney = mk("icon-rect");
export const AutoAwesome = mk("icon-sparkle");
export const AutoAwesomeMotion = mk("icon-sparkle");
export const AutoFixHigh = mk("icon-sparkle");
export const AutoFixNormal = mk("icon-eraser");
export const AutoStories = mk("icon-book");
export const Autorenew = mk("icon-reload");

/* ------------------------------------ B ------------------------------------ */
export const Block = mk("icon-plus", 45);
export const BlockOutlined = mk("icon-plus", 45);
export const BlurOn = mk("icon-sparkle");
export const Bolt = mk("icon-bolt");
export const BookmarkAdd = mk("icon-book");
export const Brush = mk("icon-brush");
export const BugReport = mk("icon-ellipse");
export const Build = mk("icon-gear");

/* ------------------------------------ C ------------------------------------ */
export const CallMade = mk("icon-expand");
export const CallReceived = mk("icon-chevron-down");
export const CallToAction = mk("icon-filter");
export const CameraAltOutlined = mk("icon-rect");
export const Cancel = mk("icon-plus", 45);
export const Casino = mk("icon-sparkle");
export const Category = mk("icon-layers");
export const CenterFocusStrong = mk("icon-ellipse");
export const ChangeHistory = mk("icon-layers");
export const Chat = mk("icon-chat");
export const Check = mk("icon-line");
export const CheckBox = mk("icon-line");
export const CheckBoxOutlineBlank = mk("icon-expand", 0, 0.6);
export const CheckCircle = mk("icon-line");
export const CheckCircleOutlined = mk("icon-line");
export const Checklist = mk("icon-line");
export const ChevronLeft = mk("icon-chevron-down", 90);
export const ChevronRight = mk("icon-chevron-down", -90);
export const ChevronRightRounded = mk("icon-chevron-down", -90);
export const Circle = mk("icon-ellipse");
export const CircleOutlined = mk("icon-ellipse");
export const Clear = mk("icon-plus", 45);
export const Close = mk("icon-plus", 45);
export const CloseFullscreen = mk("icon-collapse");
export const ClosedCaption = mk("icon-chat");
export const Cloud = mk("icon-globe");
export const CloudQueue = mk("icon-globe");
export const Code = mk("icon-terminal");
export const CodeOutlined = mk("icon-terminal");
export const Collections = mk("icon-rect");
// Material's `Colorize` is the eyedropper, not the palette — call sites
// sample a colour rather than choose a theme.
export const Colorize = mk("icon-picker");
export const CompareArrows = mk("icon-compare");
export const Construction = mk("icon-gear");
export const ContentCopy = mk("icon-compare");
export const ContentPaste = mk("icon-compare");
export const CreateNewFolder = mk("icon-folder");
export const CrisisAlert = mk("icon-bolt");
export const CropFree = mk("icon-expand");
export const CropSquare = mk("icon-expand");

/* ------------------------------------ D ------------------------------------ */
export const DarkMode = mk("icon-palette");
export const Dashboard = mk("icon-grid");
export const DashboardCustomize = mk("icon-grid");
export const DataObject = mk("icon-terminal");
export const Delete = mk("icon-trash");
export const DeleteOutlineOutlined = mk("icon-trash");
export const DeleteOutlined = mk("icon-trash");
export const DeleteSweep = mk("icon-trash");
export const Description = mk("icon-book");
export const DescriptionOutlined = mk("icon-book");
export const DesktopWindows = mk("icon-rect");
export const Difference = mk("icon-compare");
export const DifferenceOutlined = mk("icon-compare");
export const Dns = mk("icon-layers");
export const Download = mk("icon-chevron-down");
export const DragIndicator = mk("icon-grid");
export const DriveFileMove = mk("icon-folder");

/* ------------------------------------ E ------------------------------------ */
export const Edit = mk("icon-brush");
export const EditNote = mk("icon-brush");
export const EmojiEmotions = mk("icon-sparkle");
export const Error = mk("icon-bolt");
export const ExpandLess = mk("icon-chevron-up");
export const ExpandMore = mk("icon-chevron-down");
export const Extension = mk("icon-plugin");

/* ------------------------------------ F ------------------------------------ */
export const FactCheck = mk("icon-line");
export const Favorite = mk("icon-sparkle");
export const FiberManualRecord = mk("icon-ellipse");
export const FileDownload = mk("icon-chevron-down");
export const FileDownloadOutlined = mk("icon-chevron-down");
export const FileOpenOutlined = mk("icon-book");
export const FileUpload = mk("icon-chevron-up");
export const FilterAlt = mk("icon-filter");
export const FilterAltOff = mk("icon-filter-off");
export const FilterList = mk("icon-filter");
export const FilterNone = mk("icon-compare");
export const FirstPage = mk("icon-chevron-down", 90);
export const FitScreen = mk("icon-expand");
export const Flag = mk("icon-picker");
export const FlipToBack = mk("icon-compare");
export const FlipToFront = mk("icon-compare");
export const Folder = mk("icon-folder");
export const FolderOpen = mk("icon-folder");
export const FolderZipOutlined = mk("icon-folder");
export const FormatAlignCenter = mk("icon-layers");
export const FormatAlignLeft = mk("icon-layers");
export const FormatAlignRight = mk("icon-layers");
export const FormatColorFill = mk("icon-fill");
export const FormatItalic = mk("icon-brush");
export const FormatPaint = mk("icon-brush");
export const ForumRounded = mk("icon-chat");
export const Fullscreen = mk("icon-expand");
export const FullscreenExit = mk("icon-collapse");

/* ------------------------------------ G ------------------------------------ */
export const Gesture = mk("icon-brush");
export const GridOn = mk("icon-grid");
export const GridView = mk("icon-grid");

/* ------------------------------------ H ------------------------------------ */
export const HelpOutlined = mk("icon-book");
export const History = mk("icon-history");
export const Home = mk("mark");
export const HorizontalRule = mk("icon-line");
export const Hub = mk("icon-layers");

/* ------------------------------------ I ------------------------------------ */
export const Image = mk("icon-rect");
export const ImageOutlined = mk("icon-rect");
export const Info = mk("icon-book");
export const InsertDriveFile = mk("icon-book");
export const Inventory = mk("icon-layers");
export const Inventory2 = mk("icon-layers");
export const Inventory2Outlined = mk("icon-layers");

/* ------------------------------------ K ------------------------------------ */
export const Keyboard = mk("icon-keyboard");
export const KeyboardArrowDown = mk("icon-chevron-down");
export const KeyboardArrowDownRounded = mk("icon-chevron-down");
export const KeyboardArrowRight = mk("icon-chevron-down", -90);
export const KeyboardArrowRightRounded = mk("icon-chevron-down", -90);
export const KeyboardArrowUp = mk("icon-chevron-up");
export const KeyboardDoubleArrowLeft = mk("icon-chevron-down", 90);
export const KeyboardDoubleArrowRight = mk("icon-chevron-down", -90);
export const KeyboardTab = mk("icon-wrap");

/* ------------------------------------ L ------------------------------------ */
export const Label = mk("icon-rect");
export const Language = mk("icon-globe");
export const Launch = mk("icon-expand");
export const Layers = mk("icon-layers");
export const LightMode = mk("icon-ellipse");
export const Lightbulb = mk("icon-bolt");
export const Link = mk("icon-sync");
export const LinkOff = mk("icon-sync", 0, 0.55);
export const ListAlt = mk("icon-layers");
export const Lock = mk("icon-account");
export const LockOpen = mk("icon-account");
export const LockOutlined = mk("icon-account");
export const Logout = mk("icon-bolt");

/* ------------------------------------ M ------------------------------------ */
export const Memory = mk("icon-layers");
export const Menu = mk("icon-layers");
export const MenuBook = mk("icon-book");
export const MenuBookRounded = mk("icon-book");
export const Merge = mk("icon-layers");
export const Minimize = mk("icon-line");
export const MoreHoriz = mk("icon-grid");
export const MoreVert = mk("icon-grid", 90);

/* ------------------------------------ N ------------------------------------ */
export const NavigateBefore = mk("icon-chevron-down", 90);
export const NavigateNext = mk("icon-chevron-down", -90);
export const NearMe = mk("icon-picker");
export const NoteAdd = mk("icon-book");
export const Notes = mk("icon-book");
export const Notifications = mk("icon-chat");

/* ------------------------------------ O ------------------------------------ */
export const OpenInBrowser = mk("icon-expand");
export const OpenInFull = mk("icon-expand");
export const OpenInNew = mk("icon-expand");
export const OpenWith = mk("icon-grid");

/* ------------------------------------ P ------------------------------------ */
export const Paid = mk("icon-rect");
export const Palette = mk("icon-palette");
export const PaletteOutlined = mk("icon-palette");
export const PanTool = mk("icon-picker");
export const Pause = mk("icon-compare");
export const Person = mk("icon-account");
export const PlayArrow = mk("icon-play");
export const PlayCircle = mk("icon-play");
export const PlaylistAdd = mk("icon-plus");
export const PowerSettingsNew = mk("icon-bolt");
export const Print = mk("icon-book");
export const Public = mk("icon-globe");
export const PushPin = mk("icon-picker");
export const PushPinOutlined = mk("icon-picker", 0, 0.7);

/* ------------------------------------ R ------------------------------------ */
export const RadioButtonChecked = mk("icon-ellipse");
export const RadioButtonUnchecked = mk("icon-ellipse", 0, 0.45);
export const RateReview = mk("icon-brush");
export const RecordVoiceOver = mk("icon-account");
export const Redo = mk("icon-reload");
export const Refresh = mk("icon-reload");
export const Remove = mk("icon-line");
export const Replay = mk("icon-history");
export const RestartAlt = mk("icon-reload");
export const Restore = mk("icon-history");
export const RocketLaunch = mk("icon-bolt");

/* ------------------------------------ S ------------------------------------ */
export const Save = mk("icon-folder");
export const SaveOutlined = mk("icon-folder");
export const Schedule = mk("icon-history");
export const School = mk("icon-book");
export const Science = mk("icon-sparkle");
export const Search = mk("icon-search");
export const SearchRounded = mk("icon-search");
export const Security = mk("icon-account");
export const Send = mk("icon-play");
/** On-air: reads as a live transmitter (AmberX Vid streams). */
export const Sensors = mk("icon-ellipse");
export const Settings = mk("icon-gear");
export const SettingsBackupRestore = mk("icon-history");
export const SettingsEthernet = mk("icon-terminal");
export const SettingsOutlined = mk("icon-gear");
export const ShortText = mk("icon-layers");
export const SkipNext = mk("icon-chevron-down", -90);
export const SkipPrevious = mk("icon-chevron-down", 90);
export const SmartToy = mk("icon-sparkle");
export const SmartToyRounded = mk("icon-sparkle");
export const Sort = mk("icon-filter");
export const Speed = mk("icon-bolt");
export const Star = mk("icon-sparkle");
export const StarBorder = mk("icon-sparkle", 0, 0.45);
export const Stop = mk("icon-rect");
export const StopCircleOutlined = mk("icon-rect");
export const Storage = mk("icon-layers");
export const SubdirectoryArrowRight = mk("icon-wrap");
export const SwapHoriz = mk("icon-compare");
export const Sync = mk("icon-sync");

/* ------------------------------------ T ------------------------------------ */
export const Tab = mk("icon-wrap");
export const TabUnselected = mk("icon-wrap", 0, 0.6);
export const TableRows = mk("icon-layers");
export const TaskAlt = mk("icon-line");
export const Terminal = mk("icon-terminal");
export const TextFields = mk("icon-brush");
export const Timeline = mk("icon-layers");
export const Title = mk("icon-brush");
export const Toc = mk("icon-layers");
export const ToggleOn = mk("icon-bolt");
export const TravelExplore = mk("icon-globe");
export const Tune = mk("icon-filter");
export const TuneRounded = mk("icon-filter");

/* ------------------------------------ U ------------------------------------ */
export const Undo = mk("icon-history");
export const UnfoldLess = mk("icon-expand", 0, 0.6);
export const UnfoldMore = mk("icon-expand");
export const Upload = mk("icon-chevron-up");
export const UploadFile = mk("icon-chevron-up");
export const UploadFileOutlined = mk("icon-chevron-up");

/* ------------------------------------ V ------------------------------------ */
export const VerticalAlignBottom = mk("icon-chevron-down");
export const VerticalSplit = mk("icon-compare");
export const Videocam = mk("icon-rect");
export const VideocamOff = mk("icon-rect", 0, 0.5);
export const ViewColumn = mk("icon-compare");
export const ViewList = mk("icon-layers");
export const ViewModule = mk("icon-grid");
export const ViewQuilt = mk("icon-grid");
export const ViewSidebar = mk("icon-compare");
export const ViewSidebarOutlined = mk("icon-compare");
export const ViewWeek = mk("icon-compare");
export const Visibility = mk("icon-eye");
export const VisibilityOff = mk("icon-eye", 0, 0.5);
export const VolumeOff = mk("icon-chat", 0, 0.5);
export const VolumeUp = mk("icon-chat");
export const VpnKey = mk("icon-account");

/* ------------------------------------ W ------------------------------------ */
export const Warning = mk("icon-bolt");
export const WarningAmber = mk("icon-bolt");
export const Web = mk("icon-rect");
export const WebAsset = mk("icon-rect");
export const Widgets = mk("icon-grid");

/* ------------------------------------ Z ------------------------------------ */
export const ZoomIn = mk("icon-search");
export const ZoomOut = mk("icon-search", 0, 0.7);
