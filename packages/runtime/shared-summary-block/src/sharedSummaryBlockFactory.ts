/*!
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License.
 */

import {
    IChannelAttributes,
    IComponentRuntime,
    ISharedObjectServices,
} from "@fluidframework/component-runtime-definitions";
import {
    ISharedObject,
    ISharedObjectFactory,
} from "@fluidframework/shared-object-base";
import { pkgVersion } from "./packageVersion";
import { SharedSummaryBlock } from "./sharedSummaryBlock";

/**
 * The factory that defines the shared summary block.
 * @sealed
 */
export class SharedSummaryBlockFactory implements ISharedObjectFactory {
    /**
     * {@inheritDoc @fluidframework/shared-object-base#ISharedObjectFactory."type"}
     */
    public static readonly Type = "https://graph.microsoft.com/types/shared-summary-block";

    /**
     * {@inheritDoc @fluidframework/shared-object-base#ISharedObjectFactory.attributes}
     */
    public static readonly Attributes: IChannelAttributes = {
        type: SharedSummaryBlockFactory.Type,
        snapshotFormatVersion: "0.1",
        packageVersion: pkgVersion,
    };

    /**
     * {@inheritDoc @fluidframework/shared-object-base#ISharedObjectFactory."type"}
     */
    public get type() {
        return SharedSummaryBlockFactory.Type;
    }

    /**
     * {@inheritDoc @fluidframework/shared-object-base#ISharedObjectFactory.attributes}
     */
    public get attributes() {
        return SharedSummaryBlockFactory.Attributes;
    }

    /**
     * {@inheritDoc @fluidframework/shared-object-base#ISharedObjectFactory.load}
     */
    public async load(
        runtime: IComponentRuntime,
        id: string,
        services: ISharedObjectServices,
        branchId: string,
        attributes: IChannelAttributes): Promise<ISharedObject> {
        const sharedSummaryBlock = new SharedSummaryBlock(id, runtime, attributes);
        await sharedSummaryBlock.load(branchId, services);

        return sharedSummaryBlock;
    }

    /**
     * {@inheritDoc @fluidframework/shared-object-base#ISharedObjectFactory.create}
     */
    public create(runtime: IComponentRuntime, id: string): ISharedObject {
        const sharedSummaryBlock = new SharedSummaryBlock(id, runtime, SharedSummaryBlockFactory.Attributes);
        sharedSummaryBlock.initializeLocal();

        return sharedSummaryBlock;
    }
}
