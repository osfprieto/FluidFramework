/*!
 * Copyright (c) Microsoft Corporation and contributors. All rights reserved.
 * Licensed under the MIT License.
 */

import { strict as assert } from "assert";
import { ISequencedDocumentMessage } from "@fluidframework/protocol-definitions";
import { LocalClientId, UnassignedSequenceNumber, UniversalSequenceNumber } from "../constants";
import { MergeTreeMaintenanceType } from "../mergeTreeDeltaCallback";
import { MergeTreeDeltaType } from "../ops";
import { TextSegment } from "../textSegment";
import { MergeTree } from "../mergeTree";
import { countOperations } from "./testUtils";

describe("MergeTree", () => {
    let mergeTree: MergeTree;
    const localClientId = 17;
    let currentSequenceNumber: number;
    beforeEach(() => {
        mergeTree = new MergeTree();
        mergeTree.insertSegments(
            0,
            [TextSegment.make("hello world!")],
            UniversalSequenceNumber,
            LocalClientId,
            UniversalSequenceNumber,
            undefined);
        currentSequenceNumber = 0;
        mergeTree.startCollaboration(
            localClientId,
            /* minSeq: */ currentSequenceNumber,
            /* currentSeq: */ currentSequenceNumber);
    });

    describe("markRangeRemoved", () => {
        it("Event on Removal", () => {
            const count = countOperations(mergeTree);

            mergeTree.markRangeRemoved(
                4,
                6,
                currentSequenceNumber,
                localClientId,
                UnassignedSequenceNumber,
                false,
                undefined as any);

            assert.deepStrictEqual(count, {
                [MergeTreeDeltaType.REMOVE]: 1,
                [MergeTreeMaintenanceType.SPLIT]: 2,
            });
        });

        // Verify that zamboni unlinks a removed segment and raises the appropriate maintenance event.
        it("Event on Unlink", () => {
            const count = countOperations(mergeTree);

            const start = 4;
            const end = 6;

            mergeTree.markRangeRemoved(
                start,
                end,
                /* refSeq: */ currentSequenceNumber,
                /* clientId: */ localClientId,
                /* seq: */ UnassignedSequenceNumber,
                /* overwrite: */ false,
                /* opArgs */ undefined as any);

            // In order for the removed segment to unlinked by zamboni, we need to ACK the segment
            // and advance the collaboration window's minSeq past the removedSeq.
            mergeTree.ackPendingSegment({
                op: {
                    pos1: start,
                    pos2: end,
                    type: MergeTreeDeltaType.REMOVE,
                },
                // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
                sequencedMessage: {
                    sequenceNumber: ++currentSequenceNumber,
                } as ISequencedDocumentMessage,
            });

            // Move currentSeq/minSeq past the seq# at which the removal was ACKed.
            mergeTree.getCollabWindow().currentSeq = currentSequenceNumber;
            mergeTree.setMinSeq(currentSequenceNumber);

            assert.deepStrictEqual(count, {
                [MergeTreeDeltaType.REMOVE]: 1,
                [MergeTreeMaintenanceType.SPLIT]: 2,
                [MergeTreeMaintenanceType.UNLINK]: 1,
                [MergeTreeMaintenanceType.ACKNOWLEDGED]: 1,
            });
        });

        it("Remote Before Local", () => {
            const remoteClientId: number = 35;
            let remoteSequenceNumber = currentSequenceNumber;

            mergeTree.markRangeRemoved(
                4,
                6,
                remoteSequenceNumber,
                remoteClientId,
                ++remoteSequenceNumber,
                false,
                undefined as any);

            const count = countOperations(mergeTree);

            mergeTree.markRangeRemoved(
                3,
                5,
                currentSequenceNumber,
                localClientId,
                UnassignedSequenceNumber,
                false,
                undefined as any);

            assert.deepStrictEqual(count, {
                [MergeTreeDeltaType.REMOVE]: 1,
                [MergeTreeMaintenanceType.SPLIT]: 2,
            });
        });

        it("Local Before Remote", () => {
            const remoteClientId: number = 35;
            let remoteSequenceNumber = currentSequenceNumber;

            mergeTree.markRangeRemoved(
                4,
                6,
                currentSequenceNumber,
                localClientId,
                UnassignedSequenceNumber,
                false,
                undefined as any);

            const count = countOperations(mergeTree);

            mergeTree.markRangeRemoved(
                3,
                5,
                remoteSequenceNumber,
                remoteClientId,
                ++remoteSequenceNumber,
                false,
                undefined as any);

            assert.deepStrictEqual(count, {
                [MergeTreeDeltaType.REMOVE]: 1,
                [MergeTreeMaintenanceType.SPLIT]: 2,
            });
        });

        it("Local delete shadows remote", () => {
            const remoteClientId: number = 35;
            let remoteSequenceNumber = currentSequenceNumber;

            mergeTree.markRangeRemoved(
                3,
                6,
                currentSequenceNumber,
                localClientId,
                UnassignedSequenceNumber,
                false,
                undefined as any);

            const count = countOperations(mergeTree);

            mergeTree.markRangeRemoved(
                4,
                5,
                remoteSequenceNumber,
                remoteClientId,
                ++remoteSequenceNumber,
                false,
                undefined as any);

            assert.deepStrictEqual(count, {
                /* MergeTreeDeltaType.REMOVE is absent as it should not be fired. */
                [MergeTreeMaintenanceType.SPLIT]: 2,
            });
        });
    });
});
