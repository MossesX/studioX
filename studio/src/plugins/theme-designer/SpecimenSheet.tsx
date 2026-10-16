/**
 * @file The specimen sheet — a theme shown on the components it has to survive.
 *
 * A swatch strip cannot show what a radius, a density or a type scale looks
 * like, which is the whole reason a designer exists rather than a palette
 * picker. So this is a full sheet: every MUI control the app is built from, in
 * the states it is built from — variants, sizes, disabled, focused, error,
 * selected — plus the type ladder, the surfaces and the elevation ramp.
 *
 * It is **load-bearing** rather than decorative. axf-mui's P0 stripped this app
 * to brand-gallery, build-manager and one dashboard, so there is almost nothing
 * else on screen to judge a rolled theme against; until the rebuilt surfaces
 * land, this sheet IS the evidence that a theme works. That is also why it is
 * exhaustive rather than representative: the component nobody previewed is the
 * component the theme breaks.
 *
 * Everything here is MUI, per the standing rule (no hand-rolled control where
 * an MUI component exists). The only non-MUI drawing is `Glyph`, which is
 * deliberate and stated in the rule: pack SVGs paint in the brand role
 * variables and therefore recolour with the theme, whereas an
 * `@mui/icons-material` icon paints a shipped hex no theme can reach.
 *
 * ## What is forced and what is real
 *
 * `disabled`, `error`, `selected`, `checked` and `indeterminate` are real props,
 * so those states are genuinely rendered. Focus is forced with MUI's own public
 * `Mui-focusVisible` class, so it is MUI's focus styling and not a copy of it.
 *
 * **Hover is left real** — hover the marked rows to see it. There is no prop or
 * public class for it, and the only way to force it would be to re-declare
 * MUI's hover styles here, which is a second copy of a style rule that will
 * drift from the first. A specimen that lies about a state is worse than one
 * that asks for a mouse. `TableRow hover` / `ListItemButton selected` do carry
 * their own props, so the hover *surface colour* (`palette.action.hover`, which
 * is the `panel2` dial) is shown honestly there.
 */
"use client";

import * as React from "react";

import Accordion from "@mui/material/Accordion";
import AccordionDetails from "@mui/material/AccordionDetails";
import AccordionSummary from "@mui/material/AccordionSummary";
import Alert from "@mui/material/Alert";
import AlertTitle from "@mui/material/AlertTitle";
import Avatar from "@mui/material/Avatar";
import Badge from "@mui/material/Badge";
import Box from "@mui/material/Box";
import Breadcrumbs from "@mui/material/Breadcrumbs";
import Button, { buttonClasses } from "@mui/material/Button";
import ButtonGroup from "@mui/material/ButtonGroup";
import Card from "@mui/material/Card";
import CardActions from "@mui/material/CardActions";
import CardContent from "@mui/material/CardContent";
import CardHeader from "@mui/material/CardHeader";
import Checkbox from "@mui/material/Checkbox";
import Chip from "@mui/material/Chip";
import CircularProgress from "@mui/material/CircularProgress";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogContentText from "@mui/material/DialogContentText";
import DialogTitle from "@mui/material/DialogTitle";
import Divider from "@mui/material/Divider";
import FormControlLabel from "@mui/material/FormControlLabel";
import IconButton from "@mui/material/IconButton";
import LinearProgress from "@mui/material/LinearProgress";
import Link from "@mui/material/Link";
import List from "@mui/material/List";
import ListItemButton from "@mui/material/ListItemButton";
import ListItemText from "@mui/material/ListItemText";
import Menu from "@mui/material/Menu";
import MenuItem from "@mui/material/MenuItem";
import MenuList from "@mui/material/MenuList";
import Paper from "@mui/material/Paper";
import Radio from "@mui/material/Radio";
import Skeleton from "@mui/material/Skeleton";
import Slider from "@mui/material/Slider";
import Stack from "@mui/material/Stack";
import Switch from "@mui/material/Switch";
import Tab from "@mui/material/Tab";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableContainer from "@mui/material/TableContainer";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import Tabs from "@mui/material/Tabs";
import TextField from "@mui/material/TextField";
import ToggleButton from "@mui/material/ToggleButton";
import ToggleButtonGroup from "@mui/material/ToggleButtonGroup";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";

import { Glyph } from "@axf/core";

/** Every colour MUI's palette carries, so a status dial is never previewed blind. */
const COLORS = ["primary", "secondary", "success", "warning", "error", "info"] as const;

/** The derived type ramp, by the token each step publishes as. */
const TYPE_STEPS: ReadonlyArray<{ token: string; label: string }> = [
  { token: "--axf-size-hero", label: "Hero — two steps above body" },
  { token: "--axf-size-title", label: "Title — one step above" },
  { token: "--axf-size-body", label: "Body — the base size" },
  { token: "--axf-size-label", label: "Label — one step below" },
  { token: "--axf-size-micro", label: "Micro — captions, ids, counts" }
];

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Box component="section" sx={{ display: "grid", gap: 1 }}>
      <Typography
        variant="overline"
        sx={{ color: "text.secondary", lineHeight: 1.6, fontSize: 10, letterSpacing: "0.11em" }}
      >
        {title}
      </Typography>
      {children}
      <Divider sx={{ mt: 1 }} />
    </Box>
  );
}

const Row = ({ children }: { children: React.ReactNode }) => (
  <Stack direction="row" spacing={1} useFlexGap sx={{ alignItems: "center", flexWrap: "wrap" }}>
    {children}
  </Stack>
);

export interface SpecimenSheetProps {
  /**
   * Portal container. Dialogs and menus portal to `document.body` by default,
   * which puts them OUTSIDE the `ThemeScope` element that carries this theme's
   * custom properties — so they would render in the theme in force rather than
   * the one being previewed. MUI's theme reaches them through React context
   * either way; the custom properties only reach them through the DOM.
   */
  readonly container?: HTMLElement | null;
  /** The comparison panel's shorter sheet — same components, fewer states. */
  readonly compact?: boolean;
}

export default function SpecimenSheet({ container, compact = false }: SpecimenSheetProps) {
  const [tab, setTab] = React.useState(0);
  const [toggle, setToggle] = React.useState("tight");
  const [checked, setChecked] = React.useState(true);
  const [dialog, setDialog] = React.useState(false);
  const [menuAt, setMenuAt] = React.useState<HTMLElement | null>(null);
  const [slider, setSlider] = React.useState(40);

  return (
    <Box sx={{ display: "grid", gap: 2, p: 2 }}>
      {/* ------------------------------------------------------- typography */}
      <Section title="Type scale — body size × ratio, derived">
        <Box sx={{ display: "grid", gap: 0.5 }}>
          {TYPE_STEPS.map((step) => (
            <Typography
              key={step.token}
              sx={{ fontSize: `var(${step.token})`, lineHeight: 1.35 }}
              noWrap
            >
              {step.label}
            </Typography>
          ))}
        </Box>
        {!compact ? (
          <Box sx={{ display: "grid", gap: 0.25, mt: 1 }}>
            <Typography variant="h4">Heading 4 — MUI variant</Typography>
            <Typography variant="h6">Heading 6 — MUI variant</Typography>
            <Typography variant="body1">
              Body one, with an <Link href="#" onClick={(e) => e.preventDefault()}>inline link</Link>, <b>strong</b>,{" "}
              <i>italic</i> and <code style={{ fontFamily: "var(--axf-mono)" }}>mono code</code>.
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Body two, secondary — this is the `dim` dial doing its job.
            </Typography>
            <Typography variant="caption" color="text.secondary">
              Caption, tracking and weight from the typography dials.
            </Typography>
          </Box>
        ) : null}
      </Section>

      {/* ----------------------------------------------------------- buttons */}
      <Section title="Buttons — every variant, colour and state">
        <Row>
          <Button variant="contained">Contained</Button>
          <Button variant="outlined">Outlined</Button>
          <Button variant="text">Text</Button>
          <Button variant="contained" className={buttonClasses.focusVisible}>
            Focused
          </Button>
          <Button variant="contained" disabled>
            Disabled
          </Button>
          <Button variant="outlined" disabled>
            Disabled
          </Button>
        </Row>
        {!compact ? (
          <>
            <Row>
              {COLORS.map((color) => (
                <Button key={color} variant="contained" color={color} size="small">
                  {color}
                </Button>
              ))}
            </Row>
            <Row>
              {COLORS.map((color) => (
                <Button key={color} variant="outlined" color={color} size="small">
                  {color}
                </Button>
              ))}
            </Row>
            <Row>
              <Button size="small" variant="contained">
                Small
              </Button>
              <Button size="medium" variant="contained">
                Medium
              </Button>
              <Button size="large" variant="contained">
                Large
              </Button>
              <ButtonGroup variant="outlined" size="small">
                <Button>One</Button>
                <Button>Two</Button>
                <Button>Three</Button>
              </ButtonGroup>
              <Tooltip title="IconButton with a pack drawing — recolours with the theme">
                <IconButton color="primary" aria-label="brand glyph">
                  <Glyph id="icon-palette" size={18} />
                </IconButton>
              </Tooltip>
              <IconButton disabled aria-label="disabled icon button">
                <Glyph id="icon-gear" size={18} />
              </IconButton>
              <ToggleButtonGroup
                size="small"
                exclusive
                value={toggle}
                onChange={(_, next) => next && setToggle(next)}
              >
                <ToggleButton value="tight">Tight</ToggleButton>
                <ToggleButton value="normal">Normal</ToggleButton>
                <ToggleButton value="airy">Airy</ToggleButton>
              </ToggleButtonGroup>
            </Row>
          </>
        ) : null}
      </Section>

      {/* ------------------------------------------------------------ inputs */}
      <Section title="Inputs — variants, helper text, error, focused, disabled">
        <Box
          sx={{
            display: "grid",
            gap: 1.25,
            gridTemplateColumns: "repeat(auto-fill, minmax(170px, 1fr))"
          }}
        >
          <TextField size="small" label="Outlined" defaultValue="Value" />
          <TextField size="small" label="Focused" defaultValue="Value" focused />
          <TextField
            size="small"
            label="Error"
            defaultValue="nope"
            error
            helperText="This is the err dial."
          />
          <TextField size="small" label="Disabled" defaultValue="Value" disabled />
          {!compact ? (
            <>
              <TextField size="small" label="Filled" variant="filled" defaultValue="Value" />
              <TextField size="small" label="Standard" variant="standard" defaultValue="Value" />
              <TextField size="small" label="Helper" defaultValue="" helperText="Secondary text." />
              <TextField
                size="small"
                select
                label="Select"
                value="two"
                onChange={() => undefined}
              >
                <MenuItem value="one">One</MenuItem>
                <MenuItem value="two">Two</MenuItem>
                <MenuItem value="three">Three</MenuItem>
              </TextField>
              {/* Braced, not a JSX string literal — `"Two\nlines"` in an
                  attribute renders the backslash and the n. */}
              <TextField
                size="small"
                label="Multiline"
                multiline
                minRows={2}
                defaultValue={"Two lines\nof text"}
              />
            </>
          ) : null}
        </Box>
        <Row>
          <FormControlLabel
            control={<Checkbox checked={checked} onChange={(_, v) => setChecked(v)} />}
            label="Checkbox"
          />
          <FormControlLabel control={<Checkbox indeterminate />} label="Indeterminate" />
          <FormControlLabel control={<Checkbox disabled checked />} label="Disabled" disabled />
          <FormControlLabel control={<Radio checked />} label="Radio" />
          <FormControlLabel control={<Radio />} label="Off" />
          <FormControlLabel control={<Switch defaultChecked />} label="Switch" />
          <FormControlLabel control={<Switch disabled defaultChecked />} label="Disabled" disabled />
        </Row>
        <Box sx={{ px: 1, maxWidth: 320 }}>
          <Slider
            size="small"
            value={slider}
            onChange={(_, v) => setSlider(Array.isArray(v) ? v[0] : v)}
            valueLabelDisplay="auto"
            aria-label="specimen slider"
          />
        </Box>
      </Section>

      {/* ---------------------------------------------------------- surfaces */}
      <Section title="Surfaces — radius, elevation, panel ramp">
        <Row>
          {[0, 1, 3, 6, 12, 24].map((elevation) => (
            <Paper
              key={elevation}
              elevation={elevation}
              sx={{
                width: 62,
                height: 44,
                display: "grid",
                placeItems: "center",
                fontFamily: "var(--axf-mono)",
                fontSize: 11
              }}
            >
              {elevation}
            </Paper>
          ))}
        </Row>
        <Card sx={{ maxWidth: 420 }}>
          <CardHeader
            avatar={<Avatar sx={{ bgcolor: "primary.main", width: 30, height: 30 }}>A</Avatar>}
            title="Card header"
            subheader="Subheader in the dim dial"
            // `slotProps`, not `titleTypographyProps`/`subheaderTypographyProps`:
            // MUI v9 removed those, and rather than warning it forwards them to
            // the DOM — every render of this tab logged two React "does not
            // recognize the prop" errors. Caught 2026-08-12 while checking the
            // console for a different change, which is the only reason a
            // console-only fault gets found at all.
            slotProps={{
              title: { variant: "subtitle2" },
              subheader: { variant: "caption" }
            }}
          />
          <CardContent sx={{ py: 0 }}>
            <Typography variant="body2">
              Cards are where radius, elevation, the panel colour and the padding density all land
              at once — which is why a palette swatch cannot stand in for one.
            </Typography>
          </CardContent>
          <CardActions>
            <Button size="small">Action</Button>
            <Button size="small" variant="contained">
              Primary
            </Button>
          </CardActions>
        </Card>
        {!compact ? (
          <Accordion disableGutters>
            <AccordionSummary expandIcon={<Glyph id="icon-chevron-down" size={14} />}>
              <Typography variant="body2">Accordion — the sui/section shape</Typography>
            </AccordionSummary>
            <AccordionDetails>
              <Typography variant="body2" color="text.secondary">
                Divider, padding and the raised surface, in one control.
              </Typography>
            </AccordionDetails>
          </Accordion>
        ) : null}
      </Section>

      {!compact ? (
        <>
          {/* ------------------------------------------------------ feedback */}
          <Section title="Feedback — the four status dials, three ways each">
            <Box sx={{ display: "grid", gap: 0.75 }}>
              {(["success", "info", "warning", "error"] as const).map((severity) => (
                <Stack key={severity} direction="row" spacing={0.75}>
                  <Alert severity={severity} sx={{ flex: 1, py: 0 }}>
                    {severity} standard
                  </Alert>
                  <Alert severity={severity} variant="outlined" sx={{ flex: 1, py: 0 }}>
                    outlined
                  </Alert>
                  <Alert severity={severity} variant="filled" sx={{ flex: 1, py: 0 }}>
                    filled
                  </Alert>
                </Stack>
              ))}
              <Alert severity="warning">
                <AlertTitle>With a title</AlertTitle>
                Longer body text, so the alert's own type scale is visible too.
              </Alert>
            </Box>
            <Row>
              <Box sx={{ width: 160 }}>
                <LinearProgress variant="determinate" value={62} />
              </Box>
              <Box sx={{ width: 160 }}>
                <LinearProgress />
              </Box>
              <CircularProgress size={22} />
              <CircularProgress size={22} variant="determinate" value={62} />
              <Skeleton variant="rounded" width={90} height={22} />
              <Skeleton variant="circular" width={22} height={22} />
            </Row>
          </Section>

          {/* ---------------------------------------------------------- data */}
          <Section title="Data — table rows, lists, chips, badges">
            <TableContainer component={Paper} variant="outlined">
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Dial</TableCell>
                    <TableCell>Kind</TableCell>
                    <TableCell align="right">Value</TableCell>
                    <TableCell align="right">Contrast</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  <TableRow hover>
                    <TableCell>accent</TableCell>
                    <TableCell>color</TableCell>
                    <TableCell align="right">var(--axf-accent)</TableCell>
                    <TableCell align="right">4.8:1</TableCell>
                  </TableRow>
                  <TableRow hover selected>
                    <TableCell>radius</TableCell>
                    <TableCell>number</TableCell>
                    <TableCell align="right">8px</TableCell>
                    <TableCell align="right">—</TableCell>
                  </TableRow>
                  <TableRow hover>
                    <TableCell>density</TableCell>
                    <TableCell>enum</TableCell>
                    <TableCell align="right">normal</TableCell>
                    <TableCell align="right">—</TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </TableContainer>
            <Stack direction="row" spacing={1}>
              <Paper variant="outlined" sx={{ flex: 1 }}>
                <List dense disablePadding>
                  <ListItemButton selected>
                    <ListItemText primary="Selected row" secondary="palette.action.selected" />
                  </ListItemButton>
                  <ListItemButton>
                    <ListItemText primary="Hover this one" secondary="palette.action.hover" />
                  </ListItemButton>
                  <ListItemButton disabled>
                    <ListItemText primary="Disabled row" secondary="palette.action.disabled" />
                  </ListItemButton>
                </List>
              </Paper>
              <Paper variant="outlined" sx={{ flex: 1 }}>
                <MenuList dense>
                  <MenuItem selected>Menu item — selected</MenuItem>
                  <MenuItem>Menu item</MenuItem>
                  <Divider />
                  <MenuItem disabled>Disabled item</MenuItem>
                </MenuList>
              </Paper>
            </Stack>
            <Row>
              {COLORS.map((color) => (
                <Chip key={color} size="small" color={color} label={color} />
              ))}
            </Row>
            <Row>
              <Chip size="small" variant="outlined" label="outlined" />
              <Chip size="small" label="deletable" onDelete={() => undefined} />
              <Chip size="small" label="clickable" onClick={() => undefined} />
              <Chip size="small" disabled label="disabled" />
              <Chip size="small" avatar={<Avatar>G</Avatar>} label="avatar" />
              <Badge badgeContent={7} color="error">
                <Glyph id="icon-book" size={18} />
              </Badge>
              <Badge variant="dot" color="success">
                <Glyph id="icon-sync" size={18} />
              </Badge>
            </Row>
          </Section>

          {/* ---------------------------------------------------- navigation */}
          <Section title="Navigation and overlays">
            <Tabs value={tab} onChange={(_, v) => setTab(v)} variant="scrollable">
              <Tab label="Dials" />
              <Tab label="Preview" />
              <Tab label="Cascade" />
              <Tab label="Disabled" disabled />
            </Tabs>
            <Breadcrumbs sx={{ fontSize: "var(--axf-size-label)" }}>
              <Link href="#" underline="hover" color="inherit" onClick={(e) => e.preventDefault()}>
                studio
              </Link>
              <Link href="#" underline="hover" color="inherit" onClick={(e) => e.preventDefault()}>
                theme
              </Link>
              <Typography variant="body2" color="text.primary">
                designer
              </Typography>
            </Breadcrumbs>
            <Row>
              <Button size="small" variant="outlined" onClick={() => setDialog(true)}>
                Open dialog
              </Button>
              <Button
                size="small"
                variant="outlined"
                onClick={(e) => setMenuAt(e.currentTarget)}
              >
                Open menu
              </Button>
              <Tooltip title="Tooltips are themed too" open placement="right">
                <Chip size="small" label="tooltip →" />
              </Tooltip>
            </Row>

            {/* Portalled into the ThemeScope element, not document.body — see
                the `container` prop's docblock. */}
            <Dialog open={dialog} onClose={() => setDialog(false)} container={container}>
              <DialogTitle>Dialog title</DialogTitle>
              <DialogContent>
                <DialogContentText>
                  A modal renders on the paper surface, at the theme's radius and elevation. It is
                  portalled into the preview scope so it carries this theme's variables and not the
                  one in force.
                </DialogContentText>
              </DialogContent>
              <DialogActions>
                <Button onClick={() => setDialog(false)}>Cancel</Button>
                <Button variant="contained" onClick={() => setDialog(false)}>
                  Confirm
                </Button>
              </DialogActions>
            </Dialog>
            <Menu
              open={Boolean(menuAt)}
              anchorEl={menuAt}
              onClose={() => setMenuAt(null)}
              container={container}
            >
              <MenuItem onClick={() => setMenuAt(null)}>First action</MenuItem>
              <MenuItem onClick={() => setMenuAt(null)}>Second action</MenuItem>
              <Divider />
              <MenuItem disabled>Unavailable</MenuItem>
            </Menu>
          </Section>
        </>
      ) : null}
    </Box>
  );
}
