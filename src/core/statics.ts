// Static utility table — utilities whose CSS is a fixed set of declarations.
//
// Packed as one line per CSS property, because the table is overwhelmingly
// "one property, many keyword values", and spelling the property name out once
// per utility cost more than all the values put together:
//
//   property|prefix|entry;entry;entry…
//
// Each entry names one utility. Its class name is prefix+entry, and its value
// is the entry itself — so under `overflow|overflow-|`, the entry `auto` means
// `overflow-auto` → `overflow: auto`. Where the value differs from the name,
// write it after an `=`: `hidden=none` under `display||` means the utility
// `hidden` emits `display: none`.
//
// Utilities that emit more than one declaration do not fit the grouping, and
// are listed after the groups in a plain one-per-line form:
//
//   name=prop:value;prop:value
//
// Verified against the real compiler by the conformance harness — edit freely,
// the oracle decides correctness.
export const STATICS = `display||block;inline-block;inline;flex;inline-flex;grid;inline-grid;contents;table;table-row;table-cell;flow-root;list-item;hidden=none;table-caption;table-column;table-column-group;table-footer-group;table-header-group;table-row-group;inline-table
position||static;fixed;absolute;relative;sticky
visibility||visible;invisible=hidden;collapse
isolation||isolate;isolation-auto=auto
flex-direction|flex-|row;row-reverse;col=column;col-reverse=column-reverse
flex-wrap|flex-|wrap;wrap-reverse;nowrap
flex|flex-|auto;initial=0 auto;none
flex-grow||grow=1;grow-0=0;flex-grow=1;flex-grow-0=0
flex-shrink||shrink=1;shrink-0=0;flex-shrink=1;flex-shrink-0=0
align-items|items-|start=flex-start;end=flex-end;center;baseline;stretch;center-safe=safe center;end-safe=safe flex-end;baseline-last=last baseline
justify-content|justify-|start=flex-start;end=flex-end;center;between=space-between;around=space-around;evenly=space-evenly;stretch;baseline;normal;center-safe=safe center;end-safe=safe flex-end
justify-items|justify-items-|start;end;center;stretch;center-safe=safe center;end-safe=safe end
align-self|self-|auto;start=flex-start;end=flex-end;center;stretch;baseline;center-safe=safe center;end-safe=safe flex-end;baseline-last=last baseline
align-content|content-|start=flex-start;end=flex-end;center;between=space-between;around=space-around;evenly=space-evenly;normal;baseline;stretch;center-safe=safe center;end-safe=safe flex-end
place-items|place-items-|center;start;end;baseline;stretch;center-safe=safe center;end-safe=safe end
place-content|place-content-|center;start;end;between=space-between;around=space-around;evenly=space-evenly;baseline;stretch;center-safe=safe center;end-safe=safe end
overflow|overflow-|auto;hidden;clip;visible;scroll
overflow-x|overflow-x-|auto;hidden;clip;visible;scroll
overflow-y|overflow-y-|auto;hidden;clip;visible;scroll
text-align|text-|left;center;right;justify;start;end
text-transform||uppercase;lowercase;capitalize;normal-case=none
font-style||italic;not-italic=normal
text-decoration-line||underline;overline;line-through;no-underline=none
text-decoration-style|decoration-|solid;double;dotted;dashed;wavy
white-space|whitespace-|normal;nowrap;pre;pre-line;pre-wrap;break-spaces
text-wrap|text-|wrap;nowrap;balance;pretty
overflow-wrap||break-words=break-word;wrap-normal=normal;wrap-break-word=break-word;wrap-anywhere=anywhere
word-break|break-|all=break-all;keep=keep-all
text-overflow|text-|ellipsis;clip
vertical-align|align-|baseline;top;middle;bottom;text-top;text-bottom
list-style-type|list-|none;disc;decimal
list-style-position|list-|inside;outside
pointer-events|pointer-events-|none;auto
resize||resize-none=none;resize=both;resize-y=vertical;resize-x=horizontal
box-sizing|box-|border=border-box;content=content-box
border-collapse|border-|collapse;separate
table-layout|table-|auto;fixed
--tw-mask-radial-position|mask-radial-at-|top;top-left=top left;top-right=top right;bottom;bottom-left=bottom left;bottom-right=bottom right;left;right;center
scrollbar-width|scrollbar-|thin;auto;none
scrollbar-gutter|scrollbar-gutter-|auto;stable;both-edges=stable both-edges
float|float-|left;right;start=inline-start;end=inline-end;none
clear|clear-|left;right;both;start=inline-start;end=inline-end;none
object-fit|object-|contain;cover;fill;none;scale-down
object-position|object-|center;top;bottom;left;right;top-left=left top;top-right=right top;bottom-left=left bottom;bottom-right=right bottom
will-change|will-change-|auto;scroll=scroll-position;contents;transform
appearance|appearance-|none;auto
field-sizing|field-sizing-|content;fixed
background-clip|bg-clip-|border=border-box;padding=padding-box;content=content-box;text
background-origin|bg-origin-|border=border-box;padding=padding-box;content=content-box
background-repeat|bg-|repeat;no-repeat;repeat-x;repeat-y;repeat-round=round;repeat-space=space
background-attachment|bg-|fixed;local;scroll
background-size|bg-|auto;cover;contain
background-position|bg-|center;top;bottom;left;right;top-left=left top;top-right=right top;bottom-left=left bottom;bottom-right=right bottom
background-image|bg-|none
mask-clip|mask-|clip-border=border-box;clip-padding=padding-box;clip-content=content-box;clip-fill=fill-box;clip-stroke=stroke-box;clip-view=view-box;no-clip
mask-origin|mask-origin-|border=border-box;padding=padding-box;content=content-box;fill=fill-box;stroke=stroke-box;view=view-box
mask-repeat|mask-|repeat;no-repeat;repeat-x;repeat-y;repeat-round=round;repeat-space=space
mask-size|mask-|auto;cover;contain
mask-position|mask-|center;top;bottom;left;right;top-left=left top;top-right=right top;bottom-left=left bottom;bottom-right=right bottom
mask-mode|mask-|alpha;luminance;match=match-source
mask-composite|mask-|add;subtract;intersect;exclude
mask-type|mask-type-|alpha;luminance
break-before|break-before-|auto;avoid;all;avoid-page;page;left;right;column
break-after|break-after-|auto;avoid;all;avoid-page;page;left;right;column
break-inside|break-inside-|auto;avoid;avoid-page;avoid-column
mix-blend-mode|mix-blend-|normal;multiply;screen;overlay;darken;lighten;color-dodge;color-burn;hard-light;soft-light;difference;exclusion;hue;saturation;color;luminosity;plus-darker;plus-lighter
background-blend-mode|bg-blend-|normal;multiply;screen;overlay;darken;lighten;color-dodge;color-burn;hard-light;soft-light;difference;exclusion;hue;saturation;color;luminosity;plus-darker;plus-lighter
scroll-behavior|scroll-|smooth;auto
scroll-snap-align|snap-|start;end;center;align-none=none
scroll-snap-stop|snap-|normal;always
backface-visibility|backface-|visible;hidden
perspective-origin|perspective-origin-|center;top;top-right=100% 0;right;bottom-right=100% 100%;bottom;bottom-left=0 100%;left;top-left=0 0
justify-self|justify-self-|auto;start;end;center;stretch;center-safe=safe center;end-safe=safe flex-end
place-self|place-self-|auto;start;end;center;stretch;center-safe=safe center;end-safe=safe end
grid-auto-flow|grid-flow-|row;col=column;dense;row-dense=row dense;col-dense=column dense
grid-auto-columns|auto-cols-|auto;min=min-content;max=max-content;fr=minmax(0, 1fr)
grid-auto-rows|auto-rows-|auto;min=min-content;max=max-content;fr=minmax(0, 1fr)
grid-row|row-|auto
grid-column|col-|auto
transform-origin|origin-|center;top;top-right=100% 0;right;bottom-right=100% 100%;bottom;bottom-left=0 100%;left;top-left=0 0
transform-style|transform-|3d=preserve-3d;flat
transform-box|transform-|content=content-box;border=border-box;fill=fill-box;stroke=stroke-box;view=view-box
forced-color-adjust|forced-color-adjust-|auto;none
container-type||@container=inline-size;@container-normal=normal
color-scheme|scheme-|normal;light;dark;light-dark=light dark;only-light=only light;only-dark=only dark
font-stretch|font-stretch-|ultra-condensed;extra-condensed;condensed;semi-condensed;normal;semi-expanded;expanded;extra-expanded;ultra-expanded
overscroll-behavior|overscroll-|auto;contain;none
overscroll-behavior-x|overscroll-x-|auto;contain;none
overscroll-behavior-y|overscroll-y-|auto;contain;none
--tw-mask-radial-shape|mask-|circle;ellipse
--tw-mask-radial-size|mask-radial-|closest-side;closest-corner;farthest-side;farthest-corner
break-normal=overflow-wrap:normal;word-break:normal
truncate=overflow:hidden;text-overflow:ellipsis;white-space:nowrap
antialiased=-webkit-font-smoothing:antialiased;-moz-osx-font-smoothing:grayscale
subpixel-antialiased=-webkit-font-smoothing:auto;-moz-osx-font-smoothing:auto
select-none=-webkit-user-select:none;user-select:none
select-text=-webkit-user-select:text;user-select:text
select-all=-webkit-user-select:all;user-select:all
select-auto=-webkit-user-select:auto;user-select:auto
sr-only=position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap;border-width:0
not-sr-only=position:static;width:auto;height:auto;padding:0;margin:0;overflow:visible;clip-path:none;white-space:normal
outline-solid=--tw-outline-style:solid;outline-style:solid
outline-dashed=--tw-outline-style:dashed;outline-style:dashed
outline-dotted=--tw-outline-style:dotted;outline-style:dotted
outline-double=--tw-outline-style:double;outline-style:double
box-decoration-clone=-webkit-box-decoration-break:clone;box-decoration-break:clone
box-decoration-slice=-webkit-box-decoration-break:slice;box-decoration-break:slice
hyphens-none=-webkit-hyphens:none;hyphens:none
hyphens-manual=-webkit-hyphens:manual;hyphens:manual
hyphens-auto=-webkit-hyphens:auto;hyphens:auto`;
