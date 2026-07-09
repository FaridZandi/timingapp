[x] Rotate JSONL observations into one file per local day.

[ ] Do something about the "Other" apps that shows up in the timeline. It's very inconvenient. 

[ ] Change the appearance of the idle times. Not show anything at all? 

[ ] Adding buttons to move to the next/previous day in the timeline view. 

[ ] Add a "Today" button to the timeline view. 

[ ] Add a "weekly" view to the timeline view. This should somehow decide on a single lane that shows the most important app at each time. and then show the 7 days in a 7 columns. 

[ ] consistency problem: At a certain zoom level, I can see a block. If I zoom in more, the block disappears. This is because at the lower zoom level, the smaller blocks are close enough to be merged into a bigger block. But when I zoom in, the smaller blocks get far from each other and are no longer merged. Each individual block too small to be shown, so the whole thing disappears from view. 

[ ] Consistency problem: At different zoom level/scrolling/etc, the same app that appears at the left-most lane shows up suddenly at the middle lane, or similar situations. 

[ ] Bug fix: The footer in the dashboard is misleading because it reports observed time by summing the already-merged state.blocks, and those blocks can span short gaps between same-app periods that were intentionally collapsed in buildBlocks(). As a result, the displayed duration can include inactive gap time and end up larger than the actual tracked activity. This also makes it inconsistent with the daily summary below, which uses union-based duration logic and excludes internal gaps correctly.

[ ] interval zooming: drag-and-release on the timeline axis on the left, triggers a zoom to the selected interval. during the drag, the selected interval is highlighted. when released, the timeline zooms to that interval. Potentially, with some transition/animation. 

[ ] Implement Notion integration. 

[ ] Subactivity grouping: Let's say clicking on google chrome reveals a list of subactivities, like "gmail", etc. When hovering over a subactivity, the similar subactivities are highlighted in the list. Clicking on the subactivity will filter the list to only show that subactivity. The degree of similarity should be something to think about. If the exact string match is used, it might become useless. Or maybe not. 

[ ] Pressing the "fit" button, should ignore the idle times at the two ends of the timeline. If the activity starts from 9 AM and goes to 5 PM, the timeline should fit that interval, not the whole day. 

[ ] Keep a lane for all the small activities that are too small to be shown in the main lanes. This would be the rightmost lane. Technically, no block will be hidden anymore, unless it's merged into a bigger block. 