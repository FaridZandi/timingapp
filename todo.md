[x] Rotate JSONL observations into one file per local day.

[x] Do something about the "Other" apps that shows up in the timeline. It's very inconvenient. 
    [x] Keep a lane for all the small activities that are too small to be shown in the main lanes. This would be the rightmost lane. Technically, no block will be hidden anymore, unless it's merged into a bigger block. 

[ ] Change the appearance of the idle times. Not show anything at all? 

[ ] Adding buttons to move to the next/previous day in the timeline view. Add a "Today" button to the timeline view. 

[x] Add a "weekly" view to the timeline view. The weekly view wouldn't have the capacity for multiple apps to be shown in parallel. The timeline should somehow decide on a single lane that shows the most important app at each time. and then show the 7 days in a 7 columns.

[ ] consistency problem: At a certain zoom level, I can see a block. If I zoom in more, the block disappears. This is because at the lower zoom level, the smaller blocks are close enough to be merged into a bigger block. But when I zoom in, the smaller blocks get far from each other and are no longer merged. Each individual block too small to be shown, so the whole thing disappears from view. 

[ ] Consistency problem: At different zoom level/scrolling/etc, the same app that appears at the left-most lane shows up suddenly at the middle lane, or similar situations. 

[ ] Bug fix: The footer in the dashboard is misleading because it reports observed time by summing the already-merged state.blocks, and those blocks can span short gaps between same-app periods that were intentionally collapsed in buildBlocks(). As a result, the displayed duration can include inactive gap time and end up larger than the actual tracked activity. This also makes it inconsistent with the daily summary below, which uses union-based duration logic and excludes internal gaps correctly.

[ ] interval zooming: drag-and-release on the timeline axis on the left, triggers a zoom to the selected interval. during the drag, the selected interval is highlighted. when released, the timeline zooms to that interval. Potentially, with some transition/animation. 

[ ] Implement Notion integration. 

[ ] Subactivity grouping: Let's say clicking on google chrome reveals a list of subactivities, like "gmail", etc. When hovering over a subactivity, the similar subactivities are highlighted in the list. Clicking on the subactivity will filter the list to only show that subactivity. The degree of similarity should be something to think about. If the exact string match is used, it might become useless. Or maybe not. 

[ ] Pressing the "fit" button, should ignore the idle times at the two ends of the timeline. If the activity starts from 9 AM and goes to 5 PM, the timeline should fit that interval, not the whole day. 

[ ] Clicking on an app name in the summary list, filters the timeline to only show that app. There should be a "clear filter" button or something to go back to the unfiltered view. 

[ ] Think of a placeholder icon for the applications that don't seem to have an icon. Maybe a question mark, or a generic app icon. Something that will make the text align better with the other apps that have icons. 

[ ] Add the icons to the acitivity blocks in the timeline view as well. 

[ ] Sometimes the timeline view shows 1 block at a time, but it's half-width. There are actually other activities that are being hidden because of being small, so the timeline doesn't show them. They are still considered when deciding that the other app is shown in half-width. This is a problem. Either don't hide the activities at all, or if they are hidden, expand the other app to full width. The problem also exists with 2 apps being shown in 2/3 width, and the remaining 1/3 width being empty, due to some activities being hidden. 

[ ] The small blocks that are still shown but have no title, are not quite useful. Some options exist: 
    [ ] Show the app name in the block, even if it's small. 
    [ ] Artifically expand the block to a minimum width, and show the app name in it. 
    [ ] Show the app name in a tooltip. Maybe an expanded corner of the block. 
