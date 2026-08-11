# Stream Transcript Drafts to scrollback

During ASR, Subtext appends finalized timed segments as a Transcript Draft so the user can begin reading before the Source Video finishes processing. A failed or cancelled run leaves an explicit incomplete marker in terminal history but persists no Transcript Draft; this accepts partial scrollback output in exchange for making long local transcription immediately useful.
