/** Right-click on a card or block: which block, the event, and the label the menu shows. */
export type BlockContextMenu = (blockId: string, event: React.MouseEvent, label: string) => void

/** Right-click on a backlog group's heading: the Bug or User Story it stands for. */
export type GroupContextMenu = (parentId: number, event: React.MouseEvent) => void
