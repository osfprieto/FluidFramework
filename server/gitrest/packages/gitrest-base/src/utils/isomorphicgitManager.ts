/*!
 * Copyright (c) Microsoft Corporation and contributors. All rights reserved.
 * Licensed under the MIT License.
 */

import * as isomorphicGit from "isomorphic-git";
import type * as resources from "@fluidframework/gitresources";
import { NetworkError } from "@fluidframework/server-services-client";
import { Lumberjack } from "@fluidframework/server-services-telemetry";
import { IExternalStorageManager } from "../externalStorageManager";
import * as helpers from "./helpers";
import * as conversions from "./isomorphicgitConversions";
import {
    IExternalWriterConfig,
    IRepositoryManager,
    IFileSystemManager,
    IFileSystemManagerFactory,
    IStorageDirectoryConfig,
    BaseGitRestTelemetryProperties,
} from "./definitions";
import { RepositoryManagerFactoryBase } from "./repositoryManagerFactoryBase";

export class IsomorphicGitRepositoryManager implements IRepositoryManager {
    constructor(
        private readonly fileSystemManager: IFileSystemManager,
        private readonly repoOwner: string,
        private readonly repoName: string,
        private readonly directory: string,
        private readonly lumberjackBaseProperties: Record<string, any>,
    ) {}

    public get path(): string {
        return this.directory;
    }

    public async getCommit(sha: string): Promise<resources.ICommit> {
        const commit = await isomorphicGit.readCommit({
                fs: this.fileSystemManager,
                gitdir: this.directory,
                oid: sha,
            });
        return conversions.commitToICommit(commit);
    }

    public async getCommits(
        sha: string,
        count: number,
        externalWriterConfig?: IExternalWriterConfig,
    ): Promise<resources.ICommitDetails[]> {
        try {
            const commits = await isomorphicGit.log({
                fs: this.fileSystemManager,
                gitdir: this.directory,
                ref: sha,
                depth: count,
            });

            return commits.map((rawCommit) => {
                const gitCommit = conversions.commitToICommit(rawCommit);
                const result: resources.ICommitDetails =
                {
                    commit: {
                        author: gitCommit.author,
                        committer: gitCommit.committer,
                        message: gitCommit.message,
                        tree: gitCommit.tree,
                        url: gitCommit.url,
                    },
                    parents: gitCommit.parents,
                    sha: gitCommit.sha,
                    url: "",

                };
                return result;
            });
        } catch (err) {
            Lumberjack.error(
                "getCommits error",
                {
                    ...this.lumberjackBaseProperties,
                    [BaseGitRestTelemetryProperties.sha]: sha,
                    count,
                },
                err);
            throw new NetworkError(500, "Unable to get commits.");
        }
    }

    private async getTreeInternal(sha: string): Promise<resources.ITree> {
        const readTreeResult = await isomorphicGit.readTree({
            fs: this.fileSystemManager,
            gitdir: this.directory,
            oid: sha,
        });

        const entries = readTreeResult.tree;
        const outputEntries: resources.ITreeEntry[] = [];
        for (const entry of entries) {
            const output = conversions.treeEntryToITreeEntry(entry);
            outputEntries.push(output);
        }

        return {
            sha: readTreeResult.oid,
            tree: outputEntries,
            url: "",
        };
    }

    private async getTreeInternalRecursive(sha: string): Promise<resources.ITree> {
        const mapFunction: isomorphicGit.WalkerMap = async (filepath, [walkerEntry]) => {
            if (filepath !== "." && filepath !== "..") {
                const type = await walkerEntry.type();
                const mode = (await walkerEntry.mode()).toString(8);
                const oid = await walkerEntry.oid();
                return {
                    type,
                    mode,
                    oid,
                    path: filepath,
                };
            }
        };
        const root = isomorphicGit.TREE({ ref: sha });
        const results = await isomorphicGit.walk({
            fs: this.fileSystemManager,
            gitdir: this.directory,
            trees: [root],
            map: mapFunction,
        });

        const entries = results as isomorphicGit.TreeEntry[];
        const outputEntries: resources.ITreeEntry[] = [];

        for (const entry of entries) {
            const output = conversions.treeEntryToITreeEntry(entry);
            outputEntries.push(output);
        }

        return {
            sha,
            tree: outputEntries,
            url: "",
        };
    }

    public async getTree(rootSha: string, recursive: boolean): Promise<resources.ITree> {
        if (recursive) {
            return this.getTreeInternalRecursive(rootSha);
        }
        return this.getTreeInternal(rootSha);
    }

    public async getBlob(sha: string): Promise<resources.IBlob> {
        const blob = await isomorphicGit.readBlob({
                fs: this.fileSystemManager,
                gitdir: this.directory,
                oid: sha,
            });
        return conversions.blobToIBlob(blob, this.repoOwner, this.repoName);
    }

    public async getContent(commit: string, contentPath: string): Promise<resources.IBlob> {
        const blob = await isomorphicGit.readBlob({
                fs: this.fileSystemManager,
                gitdir: this.directory,
                oid: commit,
                filepath: contentPath,
            });
        return conversions.blobToIBlob(blob, this.repoOwner, this.repoName);
    }

    public async createBlob(createBlobParams: resources.ICreateBlobParams): Promise<resources.ICreateBlobResponse> {
        if (!helpers.validateBlobContent(createBlobParams.content) ||
            !helpers.validateBlobEncoding(createBlobParams.encoding)) {
            throw new NetworkError(400, "Invalid blob");
        }
        const blobOid = await isomorphicGit.writeBlob({
            fs: this.fileSystemManager,
            gitdir: this.directory,
            blob: Buffer.from(createBlobParams.content, createBlobParams.encoding),
        });

        return {
            sha: blobOid,
            url: `/repos/${this.repoOwner}/${this.repoName}/git/blobs/${blobOid}`,
        };
    }

    public async createTree(params: resources.ICreateTreeParams): Promise<resources.ITree> {
        const isoGitTreeObject: isomorphicGit.TreeObject = [];

        // build up the tree
        for (const node of params.tree) {
            isoGitTreeObject.push(conversions.iCreateTreeEntryToTreeEntry(node));
        }

        const id = await isomorphicGit.writeTree({
            fs: this.fileSystemManager,
            gitdir: this.directory,
            tree: isoGitTreeObject,
        });
        return this.getTreeInternal(id);
    }

    public async createCommit(commit: resources.ICreateCommitParams): Promise<resources.ICommit> {
        const commitObject = conversions.iCreateCommitParamsToCommitObject(commit);
        const commitOid = await isomorphicGit.writeCommit({
            fs: this.fileSystemManager,
            gitdir: this.directory,
            commit: commitObject,
        });

        return {
            author: commit.author,
            committer: commit.author,
            message: commit.message,
            parents: commitObject.parent ? commit.parents.map((parent) => ({ sha: parent, url: "" })) : [],
            sha: commitOid,
            tree: {
                sha: commit.tree,
                url: "",
            },
            url: "",
        };
    }

    public async getRefs(): Promise<resources.IRef[]> {
        const refIds: string[] = [];
        const [branches, tags] = await Promise.all([
            isomorphicGit.listBranches({
                fs: this.fileSystemManager,
                gitdir: this.directory,
            }),
            isomorphicGit.listTags({
                fs: this.fileSystemManager,
                gitdir: this.directory,
            }),
        ]);

        refIds.push(...branches, ...tags);

        const resolvedAndExpandedRefs = await Promise.all(
            refIds.map(
                async (refId) => {
                    const [resolvedRef, expandedRef] = await Promise.all([
                        isomorphicGit.resolveRef({
                            fs: this.fileSystemManager,
                            gitdir: this.directory,
                            ref: refId,
                        }),
                        isomorphicGit.expandRef({
                            fs: this.fileSystemManager,
                            gitdir: this.directory,
                            ref: refId,
                        }),
                    ]);
                    return {
                        resolvedRef,
                        expandedRef,
                    };
                }));

        return resolvedAndExpandedRefs.map(
            (resolvedAndExpandedRef) =>
                conversions.refToIRef(
                    resolvedAndExpandedRef.resolvedRef,
                    resolvedAndExpandedRef.expandedRef));
    }

    public async getRef(refId: string, externalWriterConfig?: IExternalWriterConfig): Promise<resources.IRef> {
        try {
            const [resolvedRef, expandedRef] = await Promise.all([
                isomorphicGit.resolveRef({
                    fs: this.fileSystemManager,
                    gitdir: this.directory,
                    ref: refId,
                }),
                isomorphicGit.expandRef({
                    fs: this.fileSystemManager,
                    gitdir: this.directory,
                    ref: refId,
                }),
            ]);
            return conversions.refToIRef(resolvedRef, expandedRef);
        } catch (err) {
            Lumberjack.error(
                "getRef error",
                {
                    ...this.lumberjackBaseProperties,
                    [BaseGitRestTelemetryProperties.ref]: refId,
                },
                err);
            // `GitManager.getRef` relies on a 404 || 400 error code to return null.
            // That is expected by some components like Scribe.
            throw new NetworkError(400, "Unable to get ref.");
        }
    }

    public async createRef(
        createRefParams: resources.ICreateRefParams,
        externalWriterConfig?: IExternalWriterConfig,
    ): Promise<resources.IRef> {
        await isomorphicGit.writeRef({
            fs: this.fileSystemManager,
            gitdir: this.directory,
            ref: createRefParams.ref,
            value: createRefParams.sha,
        });
        return conversions.refToIRef(createRefParams.sha, createRefParams.ref);
    }

    public async patchRef(
        refId: string,
        patchRefParams: resources.IPatchRefParams,
        externalWriterConfig?: IExternalWriterConfig,
    ): Promise<resources.IRef> {
        await isomorphicGit.writeRef({
            fs: this.fileSystemManager,
            gitdir: this.directory,
            ref: refId,
            value: patchRefParams.sha,
            force: patchRefParams.force,
        });
        return conversions.refToIRef(patchRefParams.sha, refId);
    }

    public async deleteRef(refId: string): Promise<void> {
        try {
            await isomorphicGit.deleteRef({
                fs: this.fileSystemManager,
                gitdir: this.directory,
                ref: refId,
            });
        } catch (e: any) {
            throw new NetworkError(500, `Failed to delete ref. Error: ${e}`);
        }
    }

    public async getTag(tagId: string): Promise<resources.ITag> {
        const readTagResult = await isomorphicGit.readTag({
            fs: this.fileSystemManager,
            gitdir: this.directory,
            oid: tagId,
        });
        return conversions.tagToITag(readTagResult);
    }

    public async createTag(tagParams: resources.ICreateTagParams): Promise<resources.ITag> {
        const tagObject = conversions.iCreateTagParamsToTagObject(tagParams);
        const tagOid = await isomorphicGit.writeTag({
            fs: this.fileSystemManager,
            gitdir: this.directory,
            tag: tagObject,
        });
        return this.getTag(tagOid);
    }
}

export class IsomorphicGitManagerFactory extends RepositoryManagerFactoryBase<void> {
    constructor(
        storageDirectoryConfig: IStorageDirectoryConfig,
        fileSystemManagerFactory: IFileSystemManagerFactory,
        externalStorageManager: IExternalStorageManager,
        repoPerDocEnabled: boolean,
    ) {
        super(storageDirectoryConfig, fileSystemManagerFactory, externalStorageManager, repoPerDocEnabled);
    }

    protected async initGitRepo(fs: IFileSystemManager, gitdir: string): Promise<void> {
        return isomorphicGit.init({
            fs,
            gitdir,
            bare: true,
        });
    }

    protected async openGitRepo(gitdir: string): Promise<void> {
        return;
    }

    protected createRepoManager(
        fileSystemManager: IFileSystemManager,
        repoOwner: string,
        repoName: string,
        repo: void,
        gitdir: string,
        externalStorageManager: IExternalStorageManager,
        lumberjackBaseProperties: Record<string, any>): IRepositoryManager {
            return new IsomorphicGitRepositoryManager(
                fileSystemManager,
                repoOwner,
                repoName,
                gitdir,
                lumberjackBaseProperties);
    }
}
